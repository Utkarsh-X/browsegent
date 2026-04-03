import { config } from 'dotenv';
config();

import { BrowseGent } from '../../src/BrowseGent';
import { getRuntimeConfig, resolveLlmSelection } from '../../src/config/runtime';
import { NEW_COMPARISON_TASKS, type ComparisonTask } from './new_comparison_tasks';
import * as fs from 'fs';
import * as path from 'path';

// ── Types ───────────────────────────────────────────────────────────────────

interface QueryResult {
  id: string;
  url: string;
  query: string;
  category: string;
  success: boolean;
  answer: string;
  failureReason?: string;
  llmCalls: number;
  llmReasons: string[];
  inputTokens: number;
  outputTokens: number;
  graphTokens: number;
  snapshotNodes: number;
  totalDOMNodes: number;
  brain1WalkMs: number;
  totalTimeMs: number;
  estimatedCostUsd: number;
  progress: {
    assessedActions: number;
    strongActions: number;
    weakActions: number;
    noEffectActions: number;
    noProgressAborts: number;
    decisionCounts: {
      accept: number;
      watch: number;
      warn: number;
      abort: number;
    };
    signalCounts: Record<string, number>;
  };
}

interface ComparisonRun {
  runName: string;
  system: string;
  model: string;
  timestamp: string;
  progressGuardsEnforced: boolean;
  totalQueries: number;
  passed: number;
  failed: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  avgTimeMs: number;
  progressTotals: {
    assessedActions: number;
    strongActions: number;
    weakActions: number;
    noEffectActions: number;
    noProgressAborts: number;
    decisionCounts: {
      accept: number;
      watch: number;
      warn: number;
      abort: number;
    };
  };
  results: QueryResult[];
}

// ── CLI args ────────────────────────────────────────────────────────────────
// Usage: npx tsx tests/eval/run_comparison.ts [run-name]

const runName = process.argv[2] ?? `browsegent_${new Date().toISOString().slice(0, 10)}`;
const logDir = path.join(__dirname, '..', '..', 'logs', 'comparison');

async function runComparison(): Promise<void> {
  const runtime = getRuntimeConfig();
  const llmSelection = resolveLlmSelection();

  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║  BrowseGent — Comparison Runner               ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`  Run:    ${runName}`);
  console.log(`  Model:  ${llmSelection.modelId}`);
  console.log(`  Guards: ${runtime.agent.enforceProgressGuards ? 'enforced' : 'telemetry-only'}`);
  console.log(`  Tasks:  ${NEW_COMPARISON_TASKS.length}\n`);

  const bg = new BrowseGent({
    model: llmSelection.modelId,
    headless: runtime.eval.headless,
    warmup: runtime.eval.warmup,
  });

  await bg.init();

  const results: QueryResult[] = [];
  let totalInput = 0;
  let totalOutput = 0;
  let totalCost = 0;
  let totalTime = 0;
  let passed = 0;
  const progressTotals = {
    assessedActions: 0,
    strongActions: 0,
    weakActions: 0,
    noEffectActions: 0,
    noProgressAborts: 0,
    decisionCounts: {
      accept: 0,
      watch: 0,
      warn: 0,
      abort: 0,
    },
  };

  for (const task of NEW_COMPARISON_TASKS) {
    console.log(`\n── ${task.id}: ${task.category} ──────────────────────`);
    console.log(`  URL:   ${task.url}`);
    console.log(`  Query: ${task.query}`);

    const t0 = Date.now();

    try {
      const result = await bg.run(task.url, task.query);
      const duration = Date.now() - t0;

      const qr: QueryResult = {
        id: task.id,
        url: task.url,
        query: task.query,
        category: task.category,
        success: result.success,
        answer: result.value?.slice(0, 200) ?? '',
        failureReason: result.failureReason,
        llmCalls: result.metrics.llmCallCount,
        llmReasons: result.metrics.llmCallReasons,
        inputTokens: result.metrics.inputTokens,
        outputTokens: result.metrics.outputTokens,
        graphTokens: result.metrics.snapshotTokens,
        snapshotNodes: result.metrics.snapshotNodes,
        totalDOMNodes: result.metrics.totalDOMNodes,
        brain1WalkMs: result.metrics.brain1WalkMs,
        totalTimeMs: duration,
        estimatedCostUsd: result.metrics.estimatedCostUsd,
        progress: result.metrics.progress,
      };

      results.push(qr);
      if (result.success) passed++;
      totalInput += result.metrics.inputTokens;
      totalOutput += result.metrics.outputTokens;
      totalCost += result.metrics.estimatedCostUsd;
      totalTime += duration;
      progressTotals.assessedActions += result.metrics.progress.assessedActions;
      progressTotals.strongActions += result.metrics.progress.strongActions;
      progressTotals.weakActions += result.metrics.progress.weakActions;
      progressTotals.noEffectActions += result.metrics.progress.noEffectActions;
      progressTotals.noProgressAborts += result.metrics.progress.noProgressAborts;
      progressTotals.decisionCounts.accept += result.metrics.progress.decisionCounts.accept;
      progressTotals.decisionCounts.watch += result.metrics.progress.decisionCounts.watch;
      progressTotals.decisionCounts.warn += result.metrics.progress.decisionCounts.warn;
      progressTotals.decisionCounts.abort += result.metrics.progress.decisionCounts.abort;

      console.log(`  ${result.success ? '✅' : '❌'} ${result.value?.slice(0, 80) ?? result.failureReason}`);
      console.log(`  LLM: ${result.metrics.llmCallCount} calls | ${result.metrics.inputTokens} in | ${result.metrics.outputTokens} out | ${duration}ms`);
      console.log(`  Progress: ${result.metrics.progress.strongActions} strong | ${result.metrics.progress.weakActions} weak | ${result.metrics.progress.noEffectActions} none | aborts ${result.metrics.progress.noProgressAborts}`);

    } catch (err) {
      const duration = Date.now() - t0;
      console.log(`  💥 Error: ${String(err).slice(0, 100)}`);
      results.push({
        id: task.id, url: task.url, query: task.query, category: task.category,
        success: false, answer: '', failureReason: `Error: ${String(err).slice(0, 200)}`,
        llmCalls: 0, llmReasons: [], inputTokens: 0, outputTokens: 0,
        graphTokens: 0, snapshotNodes: 0, totalDOMNodes: 0,
        brain1WalkMs: 0, totalTimeMs: duration, estimatedCostUsd: 0,
        progress: {
          assessedActions: 0,
          strongActions: 0,
          weakActions: 0,
          noEffectActions: 0,
          noProgressAborts: 0,
          decisionCounts: { accept: 0, watch: 0, warn: 0, abort: 0 },
          signalCounts: {},
        },
      });
      totalTime += duration;
    }
  }

  await bg.close();

  // ── Build JSONC output ──────────────────────────────────────────────────

  const run: ComparisonRun = {
    runName,
    system: 'BrowseGent',
    model: llmSelection.modelId,
    timestamp: new Date().toISOString(),
    progressGuardsEnforced: runtime.agent.enforceProgressGuards,
    totalQueries: NEW_COMPARISON_TASKS.length,
    passed,
    failed: NEW_COMPARISON_TASKS.length - passed,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalCostUsd: totalCost,
    avgTimeMs: Math.round(totalTime / NEW_COMPARISON_TASKS.length),
    progressTotals,
    results,
  };

  // Write JSONC file
  fs.mkdirSync(logDir, { recursive: true });
  const outFile = path.join(logDir, `${runName}.jsonc`);

  const jsonc = [
    `// BrowseGent Comparison Run: ${runName}`,
    `// Generated: ${run.timestamp}`,
    `// Model: ${run.model}`,
    `// Pass rate: ${passed}/${NEW_COMPARISON_TASKS.length}`,
    JSON.stringify(run, null, 2),
  ].join('\n');

  fs.writeFileSync(outFile, jsonc, 'utf-8');

  // ── Summary ──────────────────────────────────────────────────────────────

  console.log('\n══════════════════════════════════════════════');
  console.log('  COMPARISON SUMMARY');
  console.log('══════════════════════════════════════════════');
  console.log(`  Pass rate:      ${passed}/${NEW_COMPARISON_TASKS.length}`);
  console.log(`  Guards:         ${runtime.agent.enforceProgressGuards ? 'enforced' : 'telemetry-only'}`);
  console.log(`  Total tokens:   ${totalInput} in / ${totalOutput} out`);
  console.log(`  Total cost:     $${totalCost.toFixed(6)}`);
  console.log(`  Avg time:       ${run.avgTimeMs}ms`);
  console.log(`  Progress:       ${progressTotals.assessedActions} assessed | ${progressTotals.strongActions} strong | ${progressTotals.weakActions} weak | ${progressTotals.noEffectActions} none`);
  console.log(`  Decisions:      accept=${progressTotals.decisionCounts.accept} watch=${progressTotals.decisionCounts.watch} warn=${progressTotals.decisionCounts.warn} abort=${progressTotals.decisionCounts.abort}`);
  console.log(`  Results:        ${outFile}`);
  console.log('══════════════════════════════════════════════\n');

  // Print table
  console.log('| ID | Category | ✅/❌ | LLM | Tokens | Answer |');
  console.log('|----|----------|------|-----|--------|--------|');
  for (const r of results) {
    console.log(`| ${r.id} | ${r.category} | ${r.success ? '✅' : '❌'} | ${r.llmCalls} | ${r.inputTokens} | ${r.answer.slice(0, 40)} |`);
  }
}

runComparison().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
