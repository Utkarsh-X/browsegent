/**
 * Phase A2 trace analysis script.
 *
 * Classifies failures into 5 categories:
 *   target-selection  — planner chose wrong ref or couldn't find target
 *   recovery-loop     — repeated failed actions or step exhaustion from loops
 *   wrong-evidence    — completed but wrong answer (completion_mismatch) or wrong evidence collected
 *   execution         — planner invalid output, provider errors, pre-execution rejection
 *   environment       — Cloudflare, CAPTCHA, site unavailability
 *
 * Usage: npx tsx scripts/audit/analyze-traces.ts <run-dir>
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import {
  joinBenchmarkEvaluation,
  type EvaluatorVerdict,
  type RuntimeBenchmarkResult,
} from './evaluationJoin';

const runDir = process.argv[2];
if (!runDir) { console.error('Usage: npx tsx scripts/audit/analyze-traces.ts <run-dir>'); process.exit(1); }

const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
const evaluationPath = join(runDir, 'webvoyager_evaluation.json');
const evaluation = existsSync(evaluationPath)
  ? JSON.parse(readFileSync(evaluationPath, 'utf8'))
  : { verdicts: [] };
const joinedResults = joinBenchmarkEvaluation(
  report.results as RuntimeBenchmarkResult[],
  (evaluation.verdicts ?? []) as EvaluatorVerdict[],
);
const joinedByTaskId = new Map(joinedResults.map(result => [result.taskId, result]));

interface TaskAudit {
  taskId: string;
  success: boolean;
  strictPassed: boolean;
  failureReason?: string;
  failureCategory: string;
  hasLedger: boolean;
  hasOutcomes: boolean;
  ledger?: { totals: Record<string, number> };
  outcomes?: { summary: Record<string, number> };
}

function classifyFailure(
  result: any,
  outcomes: { summary: Record<string, number> } | undefined,
  joinedCategory: string,
): string {
  if (joinedCategory === 'evaluation_missing') return 'evaluation_missing';
  if (joinedCategory === 'environment') return 'environment';
  if (joinedCategory === 'internal_complete_strict_reject') return 'wrong-evidence';
  if (joinedCategory === 'success') return 'success';

  // 1. Environment — site-level blocks
  const reason = result.failureReason || '';
  if (/environment|cloudflare|captcha/i.test(reason)) return 'environment';

  // 2. Completion mismatch — internal success, strict fail
  if (result.success && result.passed !== true) return 'wrong-evidence';

  // 3. Pure success
  if (result.success && result.passed === true) return 'success';

  // 4. Step exhaustion — check if it's a recovery loop (high failed/hardBlocked ratio)
  if (/max_steps/i.test(reason)) {
    if (outcomes?.summary) {
      const failed = outcomes.summary.failed ?? 0;
      const hardBlocked = outcomes.summary.hardBlocked ?? 0;
      const total = outcomes.summary.total ?? 1;
      const failRatio = (failed + hardBlocked) / total;
      if (failRatio > 0.4 || hardBlocked > 0) return 'recovery-loop';
    }
    return 'recovery-loop'; // step exhaustion without evidence defaults to loop
  }

  // 5. Planner escalation (not environment) — check reason for target vs execution
  if (/escalat/i.test(reason)) {
    if (/not found|cannot find|no .* element|target/i.test(reason)) return 'target-selection';
    return 'execution';
  }

  // 6. Planner invalid output / dead end
  if (/dead_end|invalid_output/i.test(reason)) return 'execution';

  // 7. Provider / client errors
  if (/client_error|provider/i.test(reason)) return 'execution';

  // 8. Pre-execution rejection
  if (/pre_execution/i.test(reason)) return 'execution';

  // 9. Answer contract
  if (/answer_contract/i.test(reason)) return 'wrong-evidence';

  return 'execution';
}

const audits: TaskAudit[] = [];

for (const result of report.results) {
  const taskId = result.taskId;
  const joined = joinedByTaskId.get(taskId);
  const strictPassed = joined?.strictPassed === true;
  let hasLedger = false, hasOutcomes = false;
  let ledger: TaskAudit['ledger'], outcomes: TaskAudit['outcomes'];

  if (result.tracePath) {
    const traceRoot = dirname(result.tracePath);
    const ledgerPath = join(traceRoot, 'latency_ledger.json');
    const outcomesPath = join(traceRoot, 'action_outcomes.json');
    if (existsSync(ledgerPath)) {
      hasLedger = true;
      try { ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')); } catch {}
    }
    if (existsSync(outcomesPath)) {
      hasOutcomes = true;
      try { outcomes = JSON.parse(readFileSync(outcomesPath, 'utf8')); } catch {}
    }
  }

  const failureCategory = classifyFailure(result, outcomes, joined?.category ?? 'evaluation_missing');

  audits.push({ taskId, success: result.success, strictPassed, failureReason: result.failureReason,
    failureCategory, hasLedger, hasOutcomes, ledger, outcomes });
}

// --- Report ---
console.log('# Corrected Trace Analysis Report\n');

const evaluatorJoined = joinedResults.filter(result => result.evaluator).length;
console.log(`## Evaluator Join: ${evaluatorJoined}/${joinedResults.length} runtime results matched to evaluator verdicts\n`);

// Trace completeness
const complete = audits.filter(a => a.hasLedger && a.hasOutcomes).length;
console.log(`## Trace Completeness: ${complete}/${audits.length}\n`);

// 5-category failure distribution
const categories = new Map<string, number>();
for (const a of audits) categories.set(a.failureCategory, (categories.get(a.failureCategory) ?? 0) + 1);
const sorted = [...categories.entries()].sort((a, b) => b[1] - a[1]);
console.log('## Failure Distribution (5-category)');
for (const [cat, count] of sorted) {
  console.log(`- ${cat}: ${count}/${audits.length} (${(100 * count / audits.length).toFixed(1)}%)`);
}
const controllable = sorted.filter(([c]) => c !== 'success' && c !== 'environment');
console.log(`\n**Controllable failures:** ${controllable.map(([c, n]) => `${c} (${n})`).join(', ')}\n`);

// Latency summary
const ledgerTasks = audits.filter(a => a.ledger);
if (ledgerTasks.length > 0) {
  console.log('## Latency Summary\n');
  const agg: Record<string, number> = {};
  for (const a of ledgerTasks) {
    for (const [phase, ms] of Object.entries(a.ledger!.totals)) {
      agg[phase] = (agg[phase] ?? 0) + (ms as number);
    }
  }
  const phases = ['local_compute', 'provider', 'browser_interaction', 'stabilization_wait', 'observation_capture', 'unaccounted', 'total'];
  for (const phase of phases) {
    const totalMs = agg[phase] ?? 0;
    console.log(`- ${phase}: ${(totalMs / 1000).toFixed(1)}s total, ${(totalMs / ledgerTasks.length / 1000).toFixed(1)}s avg/task`);
  }
}

// Action economy
const outcomeTasks = audits.filter(a => a.outcomes);
if (outcomeTasks.length > 0) {
  console.log('\n## Action Economy\n');
  const agg: Record<string, number> = {};
  for (const a of outcomeTasks) {
    for (const [key, val] of Object.entries(a.outcomes!.summary)) {
      agg[key] = (agg[key] ?? 0) + (val as number);
    }
  }
  const keys = ['total', 'dispatched', 'preExecutionRejected', 'hardBlocked', 'stateChanging', 'evidenceProducing', 'inputApplied', 'failed', 'noEffect'];
  for (const key of keys) {
    const total = agg[key] ?? 0;
    console.log(`- ${key}: ${total} total, ${(total / outcomeTasks.length).toFixed(1)} avg/task`);
  }
}

// Per-task detail (non-success only)
const failedTasks = audits.filter(a => a.failureCategory !== 'success');
if (failedTasks.length > 0) {
  console.log('\n## Non-Success Task Details\n');
  for (const a of failedTasks) {
    const outcomeDetail = a.outcomes?.summary
      ? ` | failed:${a.outcomes.summary.failed ?? 0} hardBlocked:${a.outcomes.summary.hardBlocked ?? 0} noEffect:${a.outcomes.summary.noEffect ?? 0}`
      : '';
    console.log(`- **${a.taskId}**: ${a.failureCategory}${outcomeDetail}`);
    if (a.failureReason) console.log(`  reason: ${a.failureReason.slice(0, 150)}`);
  }
}
