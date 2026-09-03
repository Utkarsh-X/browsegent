import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

import { callProvider } from '../src/providers/index';
import {
  buildJudgeUserPrompt,
  collectFinalPageEvidence,
  JUDGE_SYSTEM_PROMPT,
  parseJudgeVerdict,
} from '../tests/benchmark/webvoyager/judge';
import type { WebVoyagerVerdict } from '../tests/benchmark/webvoyager/types';

/**
 * Offline re-judge for an existing WebVoyager-lite run: attaches the
 * official-methodology judge outcome to every internal-passed strict-0
 * verdict without re-running the browser benchmark. Rewrites
 * webvoyager_evaluation.json in place (original is kept as
 * webvoyager_evaluation.prejudge.json).
 *
 * Usage: npx tsx scripts/webvoyager_rejudge.ts <runDir> [--judge-model <model>]
 */

interface ReportEntry {
  taskId: string;
  value?: string;
  tracePath?: string;
}

interface EvaluationFile {
  summary: Record<string, unknown>;
  verdicts: WebVoyagerVerdict[];
  tasks: Array<{ id: string; originalQuestion: string; referenceAnswer?: { answer?: unknown } }>;
}

async function main(): Promise<void> {
  const [runDir, ...flags] = process.argv.slice(2);
  if (!runDir) {
    throw new Error('Usage: npx tsx scripts/webvoyager_rejudge.ts <runDir> [--judge-model <model>]');
  }
  const modelFlagIndex = flags.indexOf('--judge-model');
  const judgeModel = modelFlagIndex >= 0 ? flags[modelFlagIndex + 1] : undefined;

  if (!process.env.GEMINI_API_KEY) {
    const pool = Object.keys(process.env).filter(k => k.startsWith('GEMINI_API_KEY_')).map(k => process.env[k]).filter(Boolean);
    if (pool.length > 0) {
      process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY_4 || pool[0];
    }
  }

  const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8')) as { results: ReportEntry[] };
  const evaluationPath = join(runDir, 'webvoyager_evaluation.json');
  const evaluation = JSON.parse(readFileSync(evaluationPath, 'utf8')) as EvaluationFile;
  copyFileSync(evaluationPath, join(runDir, 'webvoyager_evaluation.prejudge.json'));

  const resultByTask = new Map(report.results.map(entry => [entry.taskId, entry]));
  const taskById = new Map(evaluation.tasks.map(task => [`webvoyager_${task.id.replace(/--/g, '__')}`, task]));

  let judged = 0;
  for (const verdict of evaluation.verdicts) {
    if (verdict.internalPassed !== true || verdict.strictScore !== 0 || verdict.environmentStatus !== 'normal') continue;
    const result = resultByTask.get(verdict.taskId);
    const task = taskById.get(verdict.taskId);
    if (!result?.tracePath || !task) continue;

    const outcome = await judgeWithRetry({
      goal: task.originalQuestion,
      referenceHint: typeof task.referenceAnswer?.answer === 'string' ? task.referenceAnswer.answer : undefined,
      agentAnswer: result.value ?? '',
      tracePath: result.tracePath,
      judgeModel,
    });

    verdict.judgeVerdict = outcome.verdict;
    verdict.judgeReason = outcome.reason;
    verdict.judgeScore = outcome.verdict === 'SUCCESS' ? 1 : outcome.verdict === 'NOT_SUCCESS' ? 0 : undefined;
    judged += 1;
    console.log(`${verdict.taskId}: judge=${outcome.verdict}`);
  }

  const judgedVerdicts = evaluation.verdicts.filter(verdict => verdict.judgeScore !== undefined);
  const eligible = judgedVerdicts.filter(verdict => verdict.environmentAdjustedEligible);
  const rate = (list: typeof judgedVerdicts) =>
    list.length === 0 ? 0 : list.reduce((total, verdict) => total + (verdict.judgeScore ?? 0), 0) / list.length;
  evaluation.summary.judgedCount = judgedVerdicts.length;
  evaluation.summary.judgeScoreRate = rate(judgedVerdicts);
  evaluation.summary.environmentAdjustedJudgeScore = rate(eligible);

  writeFileSync(evaluationPath, `${JSON.stringify(evaluation, null, 2)}\n`, 'utf8');
  console.log(`judged ${judged} tasks -> ${evaluationPath}`);
  console.log(`judge score: ${(evaluation.summary.judgeScoreRate ?? 0) * 100}% over ${judgedVerdicts.length} judged`);
}

async function judgeWithRetry(input: {
  goal: string;
  referenceHint?: string;
  agentAnswer: string;
  tracePath: string;
  judgeModel?: string;
}): Promise<{ verdict: 'SUCCESS' | 'NOT_SUCCESS' | 'UNAVAILABLE'; reason?: string }> {
  const userPrompt = buildJudgeUserPrompt({
    goal: input.goal,
    referenceHint: input.referenceHint,
    agentAnswer: input.agentAnswer,
    pageEvidence: collectFinalPageEvidence(input.tracePath),
  });
  try {
    const result = await callProvider(JUDGE_SYSTEM_PROMPT, userPrompt, input.judgeModel, { plainTextResponse: true });
    const verdict = parseJudgeVerdict(result.text);
    return { verdict, reason: result.text.slice(-500) };
  } catch (error) {
    return { verdict: 'UNAVAILABLE', reason: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200) };
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
