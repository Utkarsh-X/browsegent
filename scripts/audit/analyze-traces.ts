import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const runDir = process.argv[2];
if (!runDir) { console.error('Usage: npx tsx scripts/audit/analyze-traces.ts <run-dir>'); process.exit(1); }

const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));

interface TaskAudit {
  taskId: string;
  success: boolean;
  failureReason?: string;
  failureCategory: string;
  hasLedger: boolean;
  hasOutcomes: boolean;
  ledger?: { totals: Record<string, number> };
  outcomes?: { summary: Record<string, number> };
}

const audits: TaskAudit[] = [];

for (const result of report.results) {
  const taskId = result.taskId;
  let hasLedger = false, hasOutcomes = false;
  let ledger: TaskAudit['ledger'], outcomes: TaskAudit['outcomes'];

  // tracePath points to trace.json — ledger and outcomes are siblings
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

  // Classify failure category
  let failureCategory = 'success';
  if (!result.success) {
    const reason = result.failureReason || '';
    if (/environment|cloudflare|captcha/i.test(reason)) failureCategory = 'environment';
    else if (/dead_end|invalid_output/i.test(reason)) failureCategory = 'planner_failure';
    else if (/escalat/i.test(reason)) failureCategory = 'planner_failure';
    else if (/max_steps/i.test(reason)) failureCategory = 'step_exhaustion';
    else if (/answer_contract/i.test(reason)) failureCategory = 'wrong_evidence';
    else if (/client_error|provider/i.test(reason)) failureCategory = 'provider_error';
    else if (/pre_execution/i.test(reason)) failureCategory = 'pre_execution_rejection';
    else failureCategory = 'other';
  }

  audits.push({ taskId, success: result.success, failureReason: result.failureReason,
    failureCategory, hasLedger, hasOutcomes, ledger, outcomes });
}

// --- Report ---
console.log('# Phase A1 Truth Audit Report\n');

// Trace completeness
const complete = audits.filter(a => a.hasLedger && a.hasOutcomes).length;
const ledgerCount = audits.filter(a => a.hasLedger).length;
const outcomeCount = audits.filter(a => a.hasOutcomes).length;
console.log(`## Trace Completeness: ${complete}/${audits.length}`);
console.log(`- Latency ledger: ${ledgerCount}/${audits.length}`);
console.log(`- Action outcomes: ${outcomeCount}/${audits.length}\n`);

// Failure categories
const categories = new Map<string, number>();
for (const a of audits) categories.set(a.failureCategory, (categories.get(a.failureCategory) ?? 0) + 1);
const sorted = [...categories.entries()].sort((a, b) => b[1] - a[1]);
console.log('## Failure Categories (ranked by frequency)');
for (const [cat, count] of sorted) {
  console.log(`- ${cat}: ${count}/${audits.length} (${(100 * count / audits.length).toFixed(1)}%)`);
}
const controllable = sorted.filter(([c]) => c !== 'success' && c !== 'environment');
console.log(`\n**Top 2 controllable:** ${controllable.slice(0, 2).map(([c, n]) => `${c} (${n})`).join(', ')}\n`);

// Latency summary (aggregate, all 5 independent categories + unaccounted)
const ledgerTasks = audits.filter(a => a.ledger);
if (ledgerTasks.length > 0) {
  console.log('## Latency Summary (across instrumented tasks)\n');
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

// Action economy summary
const outcomeTasks = audits.filter(a => a.outcomes);
if (outcomeTasks.length > 0) {
  console.log('\n## Action Economy Summary\n');
  const agg: Record<string, number> = {};
  for (const a of outcomeTasks) {
    for (const [key, val] of Object.entries(a.outcomes!.summary)) {
      agg[key] = (agg[key] ?? 0) + (val as number);
    }
  }
  const keys = ['total', 'dispatched', 'preExecutionRejected', 'hardBlocked', 'stateChanging', 'evidenceProducing', 'failed', 'noEffect'];
  for (const key of keys) {
    const total = agg[key] ?? 0;
    console.log(`- ${key}: ${total} total, ${(total / outcomeTasks.length).toFixed(1)} avg/task`);
  }
}

// Per-task detail (failed tasks only)
const failedTasks = audits.filter(a => !a.success);
if (failedTasks.length > 0) {
  console.log('\n## Failed Task Details\n');
  for (const a of failedTasks) {
    const ledgerNote = a.hasLedger ? '✅' : '❌';
    const outcomeNote = a.hasOutcomes ? '✅' : '❌';
    console.log(`- **${a.taskId}**: ${a.failureCategory} | ledger:${ledgerNote} outcomes:${outcomeNote}`);
    if (a.failureReason) console.log(`  reason: ${a.failureReason.slice(0, 120)}`);
  }
}
