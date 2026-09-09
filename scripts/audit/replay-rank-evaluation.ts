/**
 * Offline trace replay evaluator: compares baseline vs A2 target rank
 * against the same recorded successful actions and full observations.
 * No API calls required.
 *
 * For each successful task's dispatched action with a targetRef:
 *   1. Load the full observation from the trace
 *   2. Convert all refs to ProjectionItems
 *   3. Score each item with baseline scorer and A2 scorer
 *   4. Rank by each scorer
 *   5. Report the target's rank under each, and top-8/16/32 inclusion
 *
 * Usage: npx tsx scripts/audit/replay-rank-evaluation.ts <run-dir>
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { toProjectionItem } from '../../src/v2/brain1/rankOperationalItems';
import { scoreGoalRelevance } from '../../src/v2/planner/GoalRelevance';
import type { ProjectionItem } from '../../src/v2/brain1/projectionTypes';
import type { V2Ref } from '../../src/v2/runtime/types';

const runDir = process.argv[2];
if (!runDir) { console.error('Usage: npx tsx scripts/audit/replay-rank-evaluation.ts <run-dir>'); process.exit(1); }

const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));

interface RankRow {
  taskId: string;
  episodeId: string;
  targetRef: string;
  tool: string;
  totalRefs: number;
  baselineRank: number;
  a2Rank: number;
  baselineTop8: boolean;
  baselineTop16: boolean;
  baselineTop32: boolean;
  a2Top8: boolean;
  a2Top16: boolean;
  a2Top32: boolean;
}

// Baseline scorer: matches the old goalMatchesItem logic (any goal token substring in haystack)
function baselineGoalScore(goal: string, item: ProjectionItem): number {
  const haystack = `${item.name ?? ''} ${item.text ?? ''} ${item.role ?? ''} ${item.kind}`.toLowerCase();
  const tokens = goal.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 3);
  return tokens.some(token => haystack.includes(token)) ? 60 : 0;
}

// A2 scorer: uses the corrected GoalRelevance
function a2GoalScore(goal: string, item: ProjectionItem): number {
  const relevance = scoreGoalRelevance(goal, item);
  let score = 0;
  if (relevance.tokenMatches > 0) score += Math.min(relevance.score * 10, 60);
  if (relevance.phraseMatches > 0) score += 30;
  return score;
}

function rankItems(items: ProjectionItem[], goalScorer: (goal: string, item: ProjectionItem) => number, goal: string): Array<{ refId: string; totalScore: number }> {
  const scored = items.map(item => {
    const baseScore = item.score;
    const visBonus = (item.visibility === 'visible' && item.actionability === 'ready') ? 100 : 0;
    const goalBonus = goalScorer(goal, item);
    return { refId: item.refId, totalScore: baseScore + visBonus + goalBonus };
  });
  scored.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return a.refId.localeCompare(b.refId);
  });
  return scored;
}

const rows: RankRow[] = [];
let skippedNoTarget = 0;
let skippedNoObservation = 0;

for (const result of report.results) {
  if (!result.success) continue;
  if (!result.tracePath) continue;

  const traceRoot = dirname(result.tracePath);
  const plannerDir = join(traceRoot, 'planner');
  const obsDir = join(traceRoot, 'observations');
  if (!existsSync(plannerDir) || !existsSync(obsDir)) continue;

  // Read goal from the first planner input file
  const inputFiles = readdirSync(plannerDir)
    .filter(f => f.endsWith('-input.json') && !f.includes('finalization'))
    .sort();
  if (inputFiles.length === 0) continue;
  let goal = '';
  try {
    const firstInput = JSON.parse(readFileSync(join(plannerDir, inputFiles[0]), 'utf8'));
    goal = firstInput.goal || '';
  } catch {}
  if (!goal) continue;

  // Load planner output files for dispatched actions
  const plannerFiles = readdirSync(plannerDir)
    .filter(f => f.endsWith('-output.json') && !f.includes('finalization'))
    .sort((a, b) => {
      const numA = parseInt(a.match(/episode_(\d+)/)?.[1] ?? '0');
      const numB = parseInt(b.match(/episode_(\d+)/)?.[1] ?? '0');
      return numA - numB;
    });

  for (const outputFile of plannerFiles) {
    const episodeMatch = outputFile.match(/^(episode_\d+)_obs_(\d+_\d+)/);
    if (!episodeMatch) continue;

    const episodeId = episodeMatch[1];
    const obsId = `obs_${episodeMatch[2]}`;
    const obsPath = join(obsDir, `${obsId}.json`);

    if (!existsSync(obsPath)) { skippedNoObservation++; continue; }

    let output: any;
    try { output = JSON.parse(readFileSync(join(plannerDir, outputFile), 'utf8')); } catch { continue; }

    const plan = output?.output?.plan ?? output?.plan ?? [];
    if (!Array.isArray(plan) || plan.length === 0) continue;

    // Load full observation and convert to ProjectionItems
    const observation = JSON.parse(readFileSync(obsPath, 'utf8'));
    const refs: V2Ref[] = observation.refs ?? [];
    if (refs.length === 0) continue;

    const items = refs.map(ref => toProjectionItem(ref));

    const baselineRanked = rankItems(items, baselineGoalScore, goal);
    const a2Ranked = rankItems(items, a2GoalScore, goal);

    // For each plan action with a targetRef
    for (const action of plan) {
      if (!action.ref) { skippedNoTarget++; continue; }

      const baselineIdx = baselineRanked.findIndex(r => r.refId === action.ref);
      const a2Idx = a2Ranked.findIndex(r => r.refId === action.ref);

      // Rank is 1-indexed; -1 if not found
      const baselineRank = baselineIdx >= 0 ? baselineIdx + 1 : refs.length + 1;
      const a2Rank = a2Idx >= 0 ? a2Idx + 1 : refs.length + 1;

      rows.push({
        taskId: result.taskId,
        episodeId,
        targetRef: action.ref,
        tool: action.tool,
        totalRefs: refs.length,
        baselineRank,
        a2Rank,
        baselineTop8: baselineRank <= 8,
        baselineTop16: baselineRank <= 16,
        baselineTop32: baselineRank <= 32,
        a2Top8: a2Rank <= 8,
        a2Top16: a2Rank <= 16,
        a2Top32: a2Rank <= 32,
      });
    }
  }
}

// --- Report ---
console.log('# Offline Trace Replay — Rank Evaluation\n');
console.log(`Rows evaluated: ${rows.length}`);
console.log(`Skipped (no targetRef): ${skippedNoTarget}`);
console.log(`Skipped (no observation): ${skippedNoObservation}\n`);

// Top-K inclusion rates
for (const k of [8, 16, 32]) {
  const bCount = rows.filter(r => (r as any)[`baselineTop${k}`]).length;
  const aCount = rows.filter(r => (r as any)[`a2Top${k}`]).length;
  const bRate = rows.length > 0 ? (100 * bCount / rows.length).toFixed(1) : 'N/A';
  const aRate = rows.length > 0 ? (100 * aCount / rows.length).toFixed(1) : 'N/A';
  console.log(`Top-${k}: baseline=${bCount}/${rows.length} (${bRate}%) | A2=${aCount}/${rows.length} (${aRate}%)`);
}

// Rank comparison summary
const improved = rows.filter(r => r.a2Rank < r.baselineRank).length;
const same = rows.filter(r => r.a2Rank === r.baselineRank).length;
const degraded = rows.filter(r => r.a2Rank > r.baselineRank).length;
console.log(`\nRank changes: improved=${improved} same=${same} degraded=${degraded}\n`);

// Median rank
const baselineRanks = rows.map(r => r.baselineRank).sort((a, b) => a - b);
const a2Ranks = rows.map(r => r.a2Rank).sort((a, b) => a - b);
if (baselineRanks.length > 0) {
  const medB = baselineRanks[Math.floor(baselineRanks.length / 2)];
  const medA = a2Ranks[Math.floor(a2Ranks.length / 2)];
  console.log(`Median target rank: baseline=${medB} A2=${medA}`);
}

// Per-task summary
const taskMap = new Map<string, { improved: number; same: number; degraded: number; total: number }>();
for (const row of rows) {
  const entry = taskMap.get(row.taskId) ?? { improved: 0, same: 0, degraded: 0, total: 0 };
  entry.total++;
  if (row.a2Rank < row.baselineRank) entry.improved++;
  else if (row.a2Rank === row.baselineRank) entry.same++;
  else entry.degraded++;
  taskMap.set(row.taskId, entry);
}
console.log('\n## Per-Task Rank Summary\n');
for (const [taskId, entry] of [...taskMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`- ${taskId}: ↑${entry.improved} =${entry.same} ↓${entry.degraded} (${entry.total} actions)`);
}

// Detail for degraded rows
if (degraded > 0) {
  console.log('\n## Degraded Rows Detail\n');
  for (const row of rows.filter(r => r.a2Rank > r.baselineRank)) {
    console.log(`- ${row.taskId}/${row.episodeId}: ${row.tool} ref=${row.targetRef} baseline=#${row.baselineRank} A2=#${row.a2Rank} (of ${row.totalRefs})`);
  }
}
