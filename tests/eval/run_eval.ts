import { config } from 'dotenv';
config();

import { BrowseGent } from '../../src/BrowseGent';
import fs from 'fs';

interface EvalTask {
  id: string;
  category: string;
  url: string;
  goal: string;
  successCheck: (value: string) => boolean;
  description: string;
  expectedLlmCalls: number;  // 0 = deterministic path expected, 1+ = LLM expected
}

const EVAL_TASKS: EvalTask[] = [
  // ── Static content — Step 1 hit expected, 0 LLM calls ────────────────────
  {
    id: 'wikipedia_featured',
    category: 'static_content',
    url: 'https://en.wikipedia.org/wiki/Main_Page',
    goal: 'Get the title of the featured article on Wikipedia today',
    successCheck: (v) => v.length > 5 && !/error|blocked/i.test(v),
    description: 'Static DOM — Step 1 expected. Baseline test.',
    expectedLlmCalls: 0,
  },
  {
    id: 'hacker_news_top',
    category: 'static_content',
    url: 'https://news.ycombinator.com/',
    goal: 'Get the title of the first story listed on Hacker News',
    successCheck: (v) => v.length > 5 && !/error/i.test(v),
    description: 'Minimal DOM, no JS noise — tests Brain 1 precision',
    expectedLlmCalls: 0,
  },
  {
    id: 'bbc_headline',
    category: 'static_content',
    url: 'https://www.bbc.com/news',
    goal: 'Get the main headline from BBC News homepage',
    successCheck: (v) => v.length > 15 && !/error|blocked/i.test(v),
    description: 'News content — Step 1 or LLM fallback',
    expectedLlmCalls: 1,
  },

  // ── Interaction required ───────────────────────────────────────────────────
  {
    id: 'flipkart_pagination',
    category: 'interaction_pagination',
    url: 'https://www.flipkart.com/search?q=laptop',
    goal: 'Get the price of the first laptop listed after moving to the next page of results',
    successCheck: (v) => /[\d,]+/.test(v),
    description: 'Pagination — Brain 2 click+fetch attribution expected',
    expectedLlmCalls: 0,
  },
  {
    id: 'amazon_global',
    category: 'interaction_dense_grid',
    url: 'https://www.amazon.com/s?k=laptop',
    goal: 'Get the price of the first laptop product in the search results',
    successCheck: (v) => /[\d,.]+/.test(v),
    description: 'Dense product grid, global Amazon — stealth + goal matcher',
    expectedLlmCalls: 0,
  },
  {
    id: 'github_repo_stars',
    category: 'interaction_spa',
    url: 'https://github.com/trending',
    goal: 'Get the name and star count of the first trending repository today',
    successCheck: (v) => v.length > 3,
    description: 'GitHub trending — tests GitHub DOM parsing',
    expectedLlmCalls: 0,
  },

  // ── Anti-bot protected ────────────────────────────────────────────────────
  {
    id: 'reddit_technology',
    category: 'antibot_social',
    url: 'https://www.reddit.com/r/technology',
    goal: 'Get the title of the first technology post visible on this page',
    successCheck: (v) => v.length > 15 && !/error|skip|server/i.test(v),
    description: 'Reddit — service worker present, stealth required',
    expectedLlmCalls: 1,
  },
  {
    id: 'theverge_cloudflare',
    category: 'antibot_cloudflare',
    url: 'https://www.theverge.com/',
    goal: 'Get the main headline from The Verge homepage',
    successCheck: (v) => v.length > 10 && !/error|blocked/i.test(v),
    description: 'Cloudflare protected — stealth depth test',
    expectedLlmCalls: 0,
  },

  // ── Dynamic / complex ─────────────────────────────────────────────────────
  {
    id: 'vercel_docs',
    category: 'spa_navigation',
    url: 'https://vercel.com/docs',
    goal: 'Get the main heading from the Vercel documentation page',
    successCheck: (v) => v.length > 3 && !/error/i.test(v),
    description: 'SPA — tests pushState hook P19',
    expectedLlmCalls: 0,
  },
  {
    id: 'producthunt_today',
    category: 'dynamic_content',
    url: 'https://www.producthunt.com/',
    goal: 'Get the name of the first featured product on Product Hunt today',
    successCheck: (v) => v.length > 3 && !/error|blocked/i.test(v),
    description: 'React app, dynamic content — Brain 1 on modern JS frameworks',
    expectedLlmCalls: 1,
  },
];

// ── Types ──────────────────────────────────────────────────────────────────────

interface TaskResult {
  taskId: string;
  category: string;
  url: string;
  goal: string;
  passed: boolean;
  metExpectedLlmCalls: boolean;
  value: string;
  failureReason?: string;
  metrics: {
    llmCallCount: number;
    expectedLlmCalls: number;
    inputTokens: number;
    outputTokens: number;
    llmDurationMs: number;
    totalSteps: number;
    totalTimeMs: number;
    snapshotNodes: number;
    totalDOMNodes: number;
    snapshotTokens: number;
    attributionRate: number;
    causeBreakdown: Record<string, number>;
    estimatedCostUsd: number;
    model: string;
  };
}

interface EvalReport {
  runId: string;
  timestamp: string;
  model: string;
  system: 'browsegent';
  tasks: TaskResult[];
  summary: {
    totalTasks: number;
    passed: number;
    failed: number;
    passRate: number;
    metLlmExpectations: number;
    avgLlmCallsPerTask: number;
    avgSnapshotTokensPerTask: number;
    avgInputTokensPerTask: number;
    totalCostUsd: number;
    avgTimeMs: number;
    byCategory: Record<string, { passed: number; total: number; avgLlmCalls: number }>;
  };
}

// ── Runner ─────────────────────────────────────────────────────────────────────

async function runEval(modelOverride?: string, taskFilter?: string | null): Promise<void> {
  const model = modelOverride ?? process.env['EVAL_MODEL'] ?? 'gemini-2.5-flash';
  const headless = process.env['EVAL_HEADLESS'] !== 'false';
  const warmup = process.env['EVAL_WARMUP'] !== 'false';

  // Per-run folder
  const runId = `${Date.now()}_${model.replace(/[^a-z0-9]/gi, '_')}`;
  const runDir = `logs/eval_runs/${runId}`;
  fs.mkdirSync(runDir, { recursive: true });
  process.env['LOG_DIR'] = runDir;

  // Filter tasks if --task is provided
  const tasksToRun = taskFilter
    ? EVAL_TASKS.filter(t => t.id === taskFilter)
    : EVAL_TASKS;

  if (taskFilter && tasksToRun.length === 0) {
    console.error(`Task "${taskFilter}" not found. Available: ${EVAL_TASKS.map(t => t.id).join(', ')}`);
    process.exit(1);
  }

  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║  BrowseGent — Global Evaluation Suite         ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`  Model:    ${model}`);
  console.log(`  Tasks:    ${tasksToRun.length}${taskFilter ? ` (filtered: ${taskFilter})` : ''}`);
  console.log(`  RunID:    ${runId}`);
  console.log(`  Headless: ${headless}`);
  console.log(`  Warmup:   ${warmup}\n`);

  const bg = new BrowseGent({ model, headless, warmup });
  await bg.init();

  const results: TaskResult[] = [];

  for (let i = 0; i < tasksToRun.length; i++) {
    const task = tasksToRun[i]!;
    console.log(`\n  [${i + 1}/${tasksToRun.length}] ${task.id}`);
    console.log(`  ${task.url}`);
    console.log(`  Goal: ${task.goal}`);

    try {
      const result = await bg.run(task.url, task.goal);
      const passed = result.success && task.successCheck(result.value);
      const metExpected =
        task.expectedLlmCalls === 0
          ? result.metrics.llmCallCount === 0
          : result.metrics.llmCallCount > 0;

      console.log(`  → ${passed ? '✅ PASS' : '❌ FAIL'} | LLM: ${result.metrics.llmCallCount} (exp: ${task.expectedLlmCalls}) ${metExpected ? '✅' : '⚠️'}`);
      console.log(`  → Value: "${result.value.slice(0, 60)}"`);
      console.log(`  → Tokens: ${result.metrics.snapshotTokens} graph | ${result.metrics.inputTokens}in ${result.metrics.outputTokens}out LLM`);
      console.log(`  → Time: ${result.metrics.totalTimeMs}ms | Cost: $${result.metrics.estimatedCostUsd.toFixed(6)}`);
      console.log(`  → Attribution: ${(result.metrics.attributionRate * 100).toFixed(0)}% ${JSON.stringify(result.metrics.causeBreakdown)}`);

      results.push({
        taskId: task.id, category: task.category, url: task.url, goal: task.goal,
        passed, metExpectedLlmCalls: metExpected, value: result.value, failureReason: result.failureReason,
        metrics: {
          llmCallCount: result.metrics.llmCallCount, expectedLlmCalls: task.expectedLlmCalls,
          inputTokens: result.metrics.inputTokens, outputTokens: result.metrics.outputTokens,
          llmDurationMs: result.metrics.llmDurationMs, totalSteps: result.metrics.totalSteps,
          totalTimeMs: result.metrics.totalTimeMs, snapshotNodes: result.metrics.snapshotNodes,
          totalDOMNodes: result.metrics.totalDOMNodes, snapshotTokens: result.metrics.snapshotTokens,
          attributionRate: result.metrics.attributionRate, causeBreakdown: result.metrics.causeBreakdown,
          estimatedCostUsd: result.metrics.estimatedCostUsd, model,
        },
      });

    } catch (err) {
      const errStr = String(err);

      // Quota error: save partial results and stop
      if (errStr.includes('API_QUOTA_EXCEEDED') || errStr.includes('429') || errStr.includes('RESOURCE_EXHAUSTED')) {
        console.error(`\n  ❌ API QUOTA EXCEEDED on task ${task.id}`);
        console.error(`  Switch to next GEMINI_API_KEY in .env and re-run with: --task ${task.id}`);
        console.error(`  Partial results saved to ${runDir}`);
        // Save partial results before exiting
        await bg.close();
        saveReport(results, runId, runDir, model, tasksToRun.length);
        process.exit(1);
      }

      console.log(`  → 💥 CRASH: ${errStr.slice(0, 120)}`);
      results.push({
        taskId: task.id, category: task.category, url: task.url, goal: task.goal,
        passed: false, metExpectedLlmCalls: false, value: '',
        failureReason: `crash: ${errStr.slice(0, 300)}`,
        metrics: {
          llmCallCount: 0, expectedLlmCalls: task.expectedLlmCalls,
          inputTokens: 0, outputTokens: 0, llmDurationMs: 0, totalSteps: 0, totalTimeMs: 0,
          snapshotNodes: 0, totalDOMNodes: 0, snapshotTokens: 0,
          attributionRate: 0, causeBreakdown: {}, estimatedCostUsd: 0, model,
        },
      });
    }
  }

  await bg.close();

  const passed = results.filter(r => r.passed).length;
  const metExpected = results.filter(r => r.metExpectedLlmCalls).length;
  const byCategory: Record<string, { passed: number; total: number; avgLlmCalls: number }> = {};
  for (const r of results) {
    if (!byCategory[r.category]) byCategory[r.category] = { passed: 0, total: 0, avgLlmCalls: 0 };
    byCategory[r.category]!.total++;
    byCategory[r.category]!.avgLlmCalls += r.metrics.llmCallCount;
    if (r.passed) byCategory[r.category]!.passed++;
  }
  for (const c of Object.values(byCategory)) c.avgLlmCalls /= c.total;

  saveReport(results, runId, runDir, model, tasksToRun.length);
}

function saveReport(
  results: TaskResult[],
  runId: string,
  runDir: string,
  model: string,
  totalTaskCount: number
): void {
  const passed = results.filter(r => r.passed).length;
  const metExpected = results.filter(r => r.metExpectedLlmCalls).length;
  const byCategory: Record<string, { passed: number; total: number; avgLlmCalls: number }> = {};
  for (const r of results) {
    if (!byCategory[r.category]) byCategory[r.category] = { passed: 0, total: 0, avgLlmCalls: 0 };
    byCategory[r.category]!.total++;
    byCategory[r.category]!.avgLlmCalls += r.metrics.llmCallCount;
    if (r.passed) byCategory[r.category]!.passed++;
  }
  for (const c of Object.values(byCategory)) c.avgLlmCalls /= c.total;

  const report: EvalReport = {
    runId, timestamp: new Date().toISOString(), model, system: 'browsegent', tasks: results,
    summary: {
      totalTasks: results.length, passed, failed: results.length - passed,
      passRate: results.length > 0 ? passed / results.length : 0, metLlmExpectations: metExpected,
      avgLlmCallsPerTask: results.reduce((a, r) => a + r.metrics.llmCallCount, 0) / (results.length || 1),
      avgSnapshotTokensPerTask: results.reduce((a, r) => a + r.metrics.snapshotTokens, 0) / (results.length || 1),
      avgInputTokensPerTask: results.reduce((a, r) => a + r.metrics.inputTokens, 0) / (results.length || 1),
      totalCostUsd: results.reduce((a, r) => a + r.metrics.estimatedCostUsd, 0),
      avgTimeMs: results.reduce((a, r) => a + r.metrics.totalTimeMs, 0) / (results.length || 1),
      byCategory,
    },
  };

  const reportPath = `${runDir}/report.json`;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log('\n════════════════════════════════════════════════');
  console.log('  EVALUATION SUMMARY');
  console.log('════════════════════════════════════════════════');
  console.log(`  RunID:              ${runId}`);
  console.log(`  Model:              ${model}`);
  console.log(`  Pass rate:          ${(report.summary.passRate * 100).toFixed(1)}% (${passed}/${results.length})`);
  console.log(`  LLM expectations:   ${metExpected}/${results.length} tasks matched`);
  console.log(`  Avg LLM calls:      ${report.summary.avgLlmCallsPerTask.toFixed(2)} per task`);
  console.log(`  Avg graph tokens:   ${report.summary.avgSnapshotTokensPerTask.toFixed(0)} (Brain 1 output)`);
  console.log(`  Avg LLM tokens in:  ${report.summary.avgInputTokensPerTask.toFixed(0)}`);
  console.log(`  Total cost:         $${report.summary.totalCostUsd.toFixed(5)}`);
  console.log(`  Avg time:           ${(report.summary.avgTimeMs / 1000).toFixed(1)}s`);
  console.log('\n  By category:');
  for (const [cat, { passed: p, total: t, avgLlmCalls }] of Object.entries(byCategory)) {
    console.log(`    ${cat}: ${p}/${t} | ${avgLlmCalls.toFixed(1)} avg LLM calls`);
  }
  console.log(`\n  Report → ${reportPath}`);
  console.log('════════════════════════════════════════════════\n');
}

// ── Entry point ────────────────────────────────────────────────────────────────
const modelArg = process.argv[2];
const taskFilterIdx = process.argv.indexOf('--task');
const taskFilter = taskFilterIdx !== -1 ? process.argv[taskFilterIdx + 1] ?? null : null;

runEval(modelArg, taskFilter).catch(err => { console.error('Eval crashed:', err); process.exit(1); });
