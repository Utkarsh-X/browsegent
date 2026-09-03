import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { callProvider } from '../../../src/providers/index';

/**
 * Official-methodology result judge (additive measurement, never a replacement
 * for the strict string matcher): WebVoyager's own auto-evaluator judges the
 * task instruction against the final surface evidence and the agent's answer,
 * and does NOT compare against a stored reference string — live results make
 * any single stored answer stale ('possible'-type references). This module
 * reproduces that judgment with the local provider: task + reference-as-hint +
 * bounded final-page evidence + agent answer -> SUCCESS / NOT SUCCESS.
 */

export const JUDGE_SYSTEM_PROMPT = `As an evaluator, you will be presented with the components needed to assess a web-browsing benchmark result:

1. Web Task Instruction: the natural-language task the browsing agent attempted.
2. Final Page Evidence: the interactive elements and texts present on the agent's final page, captured from the live browser.
3. Result Response: the textual answer the agent produced at the end of the task.

-- You DO NOT NEED to interact with web pages or perform actions such as booking flights or conducting searches.
-- Your primary responsibility is to assess whether the Result Response, supported by the Final Page Evidence, satisfies the Web Task Instruction.
-- Live websites legitimately return different specific results (different hotels, products, papers) than the ones recorded when the benchmark dataset was created. A concretely named result that plausibly matches the task's requirements IS a success even when the optional Reference Hint names a different specific item.
-- The task may have several requirements (e.g. locate AND summarize). Failing any requirement is NOT SUCCESS.
-- If the Result Response only describes HOW the task would be done (instructions to a human) instead of delivering the requested result, that is NOT SUCCESS.
-- If the Final Page Evidence does not support the Result Response's claims, that is NOT SUCCESS.

Answer with reasoning followed by a final line of exactly 'VERDICT: SUCCESS' or 'VERDICT: NOT SUCCESS'.`;

export interface JudgeInput {
  goal: string;
  /** One previously observed valid answer from the dataset; a hint, not a containment target. */
  referenceHint?: string;
  agentAnswer: string;
  finalUrl?: string;
  pageEvidence: string;
  judgeModel?: string;
}

export type JudgeVerdictValue = 'SUCCESS' | 'NOT_SUCCESS' | 'UNAVAILABLE';

export interface JudgeOutcome {
  verdict: JudgeVerdictValue;
  reason?: string;
}

export function buildJudgeUserPrompt(input: JudgeInput): string {
  const parts = [
    `TASK: ${input.goal}`,
    input.referenceHint ? `Reference Hint (one valid answer recorded when the dataset was created; live results may legitimately differ): ${input.referenceHint}` : undefined,
    `Result Response: ${input.agentAnswer}`,
    input.finalUrl ? `Final page URL: ${input.finalUrl}` : undefined,
    'Final Page Evidence (bounded excerpt):',
    input.pageEvidence,
  ].filter(Boolean);
  return parts.join('\n\n');
}

export function parseJudgeVerdict(text: string): JudgeVerdictValue {
  const matches = [...text.matchAll(/VERDICT:\s*(SUCCESS|NOT SUCCESS)/gi)];
  const last = matches[matches.length - 1];
  if (!last) return 'UNAVAILABLE';
  return last[1].toUpperCase() === 'SUCCESS' ? 'SUCCESS' : 'NOT_SUCCESS';
}

export async function judgeTaskResult(input: JudgeInput): Promise<JudgeOutcome> {
  try {
    const result = await callProvider(
      JUDGE_SYSTEM_PROMPT,
      buildJudgeUserPrompt(input),
      input.judgeModel,
    );
    const verdict = parseJudgeVerdict(result.text);
    // Keep the raw tail on parse failures so the output format can be fixed
    // without burning another live run.
    return { verdict, reason: result.text.slice(-500) };
  } catch (error) {
    return { verdict: 'UNAVAILABLE', reason: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200) };
  }
}

/** Extracts a bounded readable-evidence excerpt from the LAST observation of a trace. */
export function collectFinalPageEvidence(traceDir: string, maxLines = 40, maxCharsPerLine = 90): string {
  const observationsDir = join(traceDir, 'observations');
  let files: string[] = [];
  try {
    files = readdirSync(observationsDir).filter(name => /^obs_\d+_\d+\.json$/.test(name)).sort(sortByObservationIndex);
  } catch {
    return '';
  }
  const last = files[files.length - 1];
  if (!last) return '';

  try {
    const observation = JSON.parse(readFileSync(join(observationsDir, last), 'utf8'));
    const lines: string[] = [];
    for (const ref of observation.refs ?? []) {
      if (lines.length >= maxLines) break;
      const name = String(ref.name ?? '').replace(/\s+/g, ' ').trim();
      const text = String(ref.text ?? '').replace(/\s+/g, ' ').trim();
      const role = String(ref.role ?? ref.kind ?? '');
      if (!name && !text) continue;
      const line = `${role}: ${name || text}`.slice(0, maxCharsPerLine);
      if (line.length > role.length + 2) lines.push(line);
    }
    return lines.join('\n');
  } catch {
    return '';
  }
}

function sortByObservationIndex(left: string, right: string): number {
  const parse = (name: string) => name.match(/obs_(\d+)_(\d+)/)?.slice(1).map(Number) ?? [0, 0];
  const [l1, l2] = parse(left);
  const [r1, r2] = parse(right);
  return l1 - r1 || l2 - r2;
}
