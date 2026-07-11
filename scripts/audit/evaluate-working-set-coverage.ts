/**
 * Evaluate working-set coverage by replaying completed trace episodes.
 *
 * For each successful task, checks whether the dispatched targetRef appears
 * in the planner input's working-set action surface for that episode.
 *
 * Usage: npx tsx scripts/audit/evaluate-working-set-coverage.ts <run-dir>
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const runDir = process.argv[2];
if (!runDir) { console.error('Usage: npx tsx scripts/audit/evaluate-working-set-coverage.ts <run-dir>'); process.exit(1); }

const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));

interface CoverageRow {
  taskId: string;
  episodeId: string;
  executedRefId: string;
  selected: boolean;
  selectedRefCount: number;
}

const rows: CoverageRow[] = [];
let skippedNoTargetRef = 0;
let skippedNoPlanner = 0;
let taskCount = 0;

for (const result of report.results) {
  if (!result.success) continue;
  if (!result.tracePath) continue;

  taskCount++;
  const traceRoot = dirname(result.tracePath);
  const plannerDir = join(traceRoot, 'planner');
  const tracePath = result.tracePath;

  if (!existsSync(tracePath) || !existsSync(plannerDir)) continue;

  const trace = JSON.parse(readFileSync(tracePath, 'utf8'));
  const steps = trace.steps as Array<{ index: number; kind: string; targetRef?: string; status: string }>;

  // Load all planner input files, sorted by episode number
  const plannerFiles = readdirSync(plannerDir)
    .filter(f => f.endsWith('-input.json') && !f.includes('finalization'))
    .sort((a, b) => {
      const numA = parseInt(a.match(/episode_(\d+)/)?.[1] ?? '0');
      const numB = parseInt(b.match(/episode_(\d+)/)?.[1] ?? '0');
      return numA - numB;
    });

  // For each planner episode, load the output to find the dispatched plan
  // and the input to find the selected working set
  for (const inputFile of plannerFiles) {
    const episodeMatch = inputFile.match(/^(episode_\d+)/);
    if (!episodeMatch) continue;
    const episodeId = episodeMatch[1];
    const outputFile = inputFile.replace('-input.json', '-output.json');

    const inputPath = join(plannerDir, inputFile);
    const outputPath = join(plannerDir, outputFile);
    if (!existsSync(outputPath)) continue;

    let input: any, output: any;
    try {
      input = JSON.parse(readFileSync(inputPath, 'utf8'));
      output = JSON.parse(readFileSync(outputPath, 'utf8'));
    } catch { continue; }

    // Extract plan actions from output
    const plan = output?.output?.plan ?? output?.plan ?? [];
    if (!Array.isArray(plan) || plan.length === 0) continue;

    // Collect all selected ref IDs from working set action surface
    const actionSurface = input?.workingSet?.actionSurface;
    const selectedRefIds = new Set<string>();
    if (actionSurface) {
      for (const lane of ['clickableRefs', 'typeableRefs', 'readableRefs', 'selectableRefs', 'ambiguousRefs']) {
        const refs = actionSurface[lane];
        if (Array.isArray(refs)) {
          for (const ref of refs) {
            if (typeof ref === 'string') selectedRefIds.add(ref);
            else if (ref?.refId) selectedRefIds.add(ref.refId);
          }
        }
      }
    }

    // Also include navigation, primary, secondary, changed, failed refs
    for (const lane of ['navigationRefs', 'primaryRefs', 'secondaryRefs', 'changedRefs', 'failedRefs']) {
      const refs = input?.workingSet?.[lane];
      if (Array.isArray(refs)) {
        for (const ref of refs) {
          if (typeof ref === 'string') selectedRefIds.add(ref);
          else if (ref?.refId) selectedRefIds.add(ref.refId);
        }
      }
    }

    const selectedRefCount = selectedRefIds.size;

    // For each plan action, check if the target ref is in the selected set
    for (const action of plan) {
      const targetRef = action.ref;
      if (!targetRef) {
        skippedNoTargetRef++;
        continue;
      }

      rows.push({
        taskId: result.taskId,
        episodeId,
        executedRefId: targetRef,
        selected: selectedRefIds.has(targetRef),
        selectedRefCount,
      });
    }
  }
}

// --- Report ---
console.log('# Working Set Coverage Evaluation\n');
console.log(`Tasks evaluated: ${taskCount} (successful only)`);
console.log(`Coverage rows: ${rows.length}`);
console.log(`Skipped (no targetRef): ${skippedNoTargetRef}`);
console.log(`Skipped (no planner data): ${skippedNoPlanner}\n`);

const covered = rows.filter(r => r.selected).length;
const missed = rows.filter(r => !r.selected).length;
const coverageRate = rows.length > 0 ? (100 * covered / rows.length).toFixed(1) : 'N/A';

console.log(`## Coverage Summary\n`);
console.log(`- Covered: ${covered}/${rows.length} (${coverageRate}%)`);
console.log(`- Missed: ${missed}/${rows.length}`);

// Per-task breakdown
const taskMap = new Map<string, { covered: number; missed: number; total: number }>();
for (const row of rows) {
  const entry = taskMap.get(row.taskId) ?? { covered: 0, missed: 0, total: 0 };
  entry.total++;
  if (row.selected) entry.covered++;
  else entry.missed++;
  taskMap.set(row.taskId, entry);
}

console.log(`\n## Per-Task Coverage\n`);
for (const [taskId, entry] of [...taskMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const rate = (100 * entry.covered / entry.total).toFixed(0);
  console.log(`- ${taskId}: ${entry.covered}/${entry.total} (${rate}%)${entry.missed > 0 ? ` ⚠ ${entry.missed} missed` : ''}`);
}

// Selected ref count distribution
const refCounts = rows.map(r => r.selectedRefCount);
if (refCounts.length > 0) {
  refCounts.sort((a, b) => a - b);
  const median = refCounts[Math.floor(refCounts.length / 2)];
  const min = refCounts[0];
  const max = refCounts[refCounts.length - 1];
  console.log(`\n## Selected Ref Count Distribution\n`);
  console.log(`- Median: ${median}, Min: ${min}, Max: ${max}`);
}

// Missed refs detail
if (missed > 0) {
  console.log(`\n## Missed Refs Detail\n`);
  for (const row of rows.filter(r => !r.selected)) {
    console.log(`- ${row.taskId} / ${row.episodeId}: ref=${row.executedRefId} (selectedCount=${row.selectedRefCount})`);
  }
}
