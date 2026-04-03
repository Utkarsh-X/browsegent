import { config } from 'dotenv';
config();

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getRuntimeConfig, resolveLlmSelection } from '../../src/config/runtime';

type DecisionCounts = {
  accept: number;
  watch: number;
  warn: number;
  abort: number;
};

type ProgressSummary = {
  assessedActions: number;
  strongActions: number;
  weakActions: number;
  noEffectActions: number;
  noProgressAborts: number;
  decisionCounts: DecisionCounts;
};

type ComparisonResult = {
  id: string;
  category: string;
  success: boolean;
  failureReason?: string;
  llmCalls: number;
  totalTimeMs: number;
  progress: ProgressSummary;
};

type ComparisonRun = {
  runName: string;
  model: string;
  progressGuardsEnforced: boolean;
  passed: number;
  failed: number;
  avgTimeMs: number;
  progressTotals: ProgressSummary;
  results: ComparisonResult[];
};

type AbReport = {
  baseRunName: string;
  timestamp: string;
  model: string;
  telemetryOnly: ComparisonRun;
  enforced: ComparisonRun;
  delta: {
    passDelta: number;
    avgTimeDeltaMs: number;
    assessedActionsDelta: number;
    strongActionsDelta: number;
    weakActionsDelta: number;
    noEffectActionsDelta: number;
    noProgressAbortsDelta: number;
    decisionCounts: DecisionCounts;
  };
  taskDiffs: Array<{
    id: string;
    category: string;
    telemetryOnly: {
      success: boolean;
      failureReason?: string;
      llmCalls: number;
      totalTimeMs: number;
      progress: ProgressSummary;
    };
    enforced: {
      success: boolean;
      failureReason?: string;
      llmCalls: number;
      totalTimeMs: number;
      progress: ProgressSummary;
    };
  }>;
};

const baseRunName = process.argv[2] ?? `browsegent_ab_${new Date().toISOString().slice(0, 10)}`;
const logDir = path.join(__dirname, '..', '..', 'logs', 'comparison');
const nodeBin = process.execPath;
const tsxCli = path.join(__dirname, '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');
const comparisonScript = path.join(__dirname, 'run_comparison.ts');

function runVariant(runName: string, enforceProgressGuards: boolean): ComparisonRun {
  const env = {
    ...process.env,
    BROWSEGENT_ENFORCE_PROGRESS_GUARDS: enforceProgressGuards ? 'true' : 'false',
  };

  const outcome = spawnSync(
    nodeBin,
    [tsxCli, comparisonScript, runName],
    {
      cwd: path.join(__dirname, '..', '..'),
      env,
      stdio: 'inherit',
      shell: false,
    },
  );

  if (outcome.error) {
    throw new Error(`Comparison variant "${runName}" failed to start: ${outcome.error.message}`);
  }

  if (outcome.status !== 0) {
    throw new Error(`Comparison variant "${runName}" failed with exit code ${outcome.status ?? 'unknown'}.`);
  }

  return readComparisonRun(path.join(logDir, `${runName}.jsonc`));
}

function readComparisonRun(filePath: string): ComparisonRun {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const json = raw
    .split(/\r?\n/)
    .filter(line => !line.trimStart().startsWith('//'))
    .join('\n');
  return JSON.parse(json) as ComparisonRun;
}

function buildTaskDiffs(telemetryOnly: ComparisonRun, enforced: ComparisonRun): AbReport['taskDiffs'] {
  const enforcedById = new Map(enforced.results.map(result => [result.id, result]));
  return telemetryOnly.results.map(result => {
    const paired = enforcedById.get(result.id);
    if (!paired) {
      throw new Error(`Enforced run is missing result for task "${result.id}".`);
    }
    return {
      id: result.id,
      category: result.category,
      telemetryOnly: {
        success: result.success,
        failureReason: result.failureReason,
        llmCalls: result.llmCalls,
        totalTimeMs: result.totalTimeMs,
        progress: result.progress,
      },
      enforced: {
        success: paired.success,
        failureReason: paired.failureReason,
        llmCalls: paired.llmCalls,
        totalTimeMs: paired.totalTimeMs,
        progress: paired.progress,
      },
    };
  });
}

function writeReport(report: AbReport): string {
  fs.mkdirSync(logDir, { recursive: true });
  const outFile = path.join(logDir, `${report.baseRunName}_ab.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf-8');
  return outFile;
}

function main(): void {
  const runtime = getRuntimeConfig();
  const llmSelection = resolveLlmSelection();
  const telemetryRunName = `${baseRunName}_telemetry`;
  const enforcedRunName = `${baseRunName}_enforced`;

  console.log('\nA/B progress comparison');
  console.log(`  Base run: ${baseRunName}`);
  console.log(`  Model:    ${llmSelection.modelId}`);
  console.log(`  Current default guards: ${runtime.agent.enforceProgressGuards ? 'enforced' : 'telemetry-only'}`);
  console.log('  Sequence: telemetry-only -> enforced\n');

  const telemetryOnly = runVariant(telemetryRunName, false);
  const enforced = runVariant(enforcedRunName, true);

  const report: AbReport = {
    baseRunName,
    timestamp: new Date().toISOString(),
    model: llmSelection.modelId,
    telemetryOnly,
    enforced,
    delta: {
      passDelta: enforced.passed - telemetryOnly.passed,
      avgTimeDeltaMs: enforced.avgTimeMs - telemetryOnly.avgTimeMs,
      assessedActionsDelta: enforced.progressTotals.assessedActions - telemetryOnly.progressTotals.assessedActions,
      strongActionsDelta: enforced.progressTotals.strongActions - telemetryOnly.progressTotals.strongActions,
      weakActionsDelta: enforced.progressTotals.weakActions - telemetryOnly.progressTotals.weakActions,
      noEffectActionsDelta: enforced.progressTotals.noEffectActions - telemetryOnly.progressTotals.noEffectActions,
      noProgressAbortsDelta: enforced.progressTotals.noProgressAborts - telemetryOnly.progressTotals.noProgressAborts,
      decisionCounts: {
        accept: enforced.progressTotals.decisionCounts.accept - telemetryOnly.progressTotals.decisionCounts.accept,
        watch: enforced.progressTotals.decisionCounts.watch - telemetryOnly.progressTotals.decisionCounts.watch,
        warn: enforced.progressTotals.decisionCounts.warn - telemetryOnly.progressTotals.decisionCounts.warn,
        abort: enforced.progressTotals.decisionCounts.abort - telemetryOnly.progressTotals.decisionCounts.abort,
      },
    },
    taskDiffs: buildTaskDiffs(telemetryOnly, enforced),
  };

  const outFile = writeReport(report);

  console.log('\nA/B summary');
  console.log(`  Telemetry-only pass rate: ${telemetryOnly.passed}/${telemetryOnly.passed + telemetryOnly.failed}`);
  console.log(`  Enforced pass rate:       ${enforced.passed}/${enforced.passed + enforced.failed}`);
  console.log(`  Pass delta:               ${report.delta.passDelta >= 0 ? '+' : ''}${report.delta.passDelta}`);
  console.log(`  Avg time delta:           ${report.delta.avgTimeDeltaMs >= 0 ? '+' : ''}${report.delta.avgTimeDeltaMs}ms`);
  console.log(`  No-progress abort delta:  ${report.delta.noProgressAbortsDelta >= 0 ? '+' : ''}${report.delta.noProgressAbortsDelta}`);
  console.log(`  Decision delta:           accept=${formatDelta(report.delta.decisionCounts.accept)} watch=${formatDelta(report.delta.decisionCounts.watch)} warn=${formatDelta(report.delta.decisionCounts.warn)} abort=${formatDelta(report.delta.decisionCounts.abort)}`);
  console.log(`  Report:                   ${outFile}\n`);
}

function formatDelta(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

main();
