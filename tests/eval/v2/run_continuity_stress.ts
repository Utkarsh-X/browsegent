import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  BrowseGentV2Harness,
  auditTraceReplayJson,
  type BrowserObservation,
  type TraceManifest,
  type V2Ref,
  type V2ToolResult,
} from '../../../src/v2';
import { CONTINUITY_SCENARIOS, type ContinuityScenario } from './continuity_scenarios';

export interface ContinuityStressOptions {
  runId?: string;
  outputDir?: string;
  traceDir?: string;
  headed?: boolean;
  scenarios?: ContinuityScenario[];
  harnessFactory?: (input: StressHarnessFactoryInput) => StressHarness;
}

export interface StressHarnessFactoryInput {
  scenario: ContinuityScenario;
  runId: string;
  traceDir: string;
  headed: boolean;
}

export interface StressHarness {
  open(url: string): Promise<BrowserObservation>;
  observe(): Promise<BrowserObservation>;
  click(refId: string): Promise<V2ToolResult>;
  type(refId: string, text: string): Promise<V2ToolResult>;
  flushTrace(): Promise<TraceManifest>;
  close(): Promise<void>;
}

export interface ContinuityStressReport {
  runId: string;
  scenarioCount: number;
  passedCount: number;
  failedCount: number;
  reportPath: string;
  scenarioResultsPath: string;
}

export interface ContinuityStressResult {
  report: ContinuityStressReport;
  scenarioResults: ContinuityScenarioResult[];
}

export interface ContinuityScenarioResult {
  scenarioId: string;
  status: 'passed' | 'failed';
  tracePath?: string;
  failureType?: string;
  failureMessage?: string;
  metrics: ContinuityScenarioMetrics;
}

export interface ContinuityScenarioMetrics {
  refSurvival: number;
  wrongRefCount: number;
  transitionClassDistribution: Record<string, number>;
  traceComplete: boolean;
  projectionSize: number;
}

const DEFAULT_OUTPUT_DIR = 'logs/v2-stress';
const DEFAULT_TRACE_DIR = 'logs/v2-runs';

export async function runContinuityStress(options: ContinuityStressOptions = {}): Promise<ContinuityStressResult> {
  const runId = options.runId ?? `stress_${Date.now()}`;
  const outputRoot = join(options.outputDir ?? DEFAULT_OUTPUT_DIR, runId);
  const traceDir = options.traceDir ?? DEFAULT_TRACE_DIR;
  const scenarios = options.scenarios ?? CONTINUITY_SCENARIOS;
  const headed = options.headed ?? false;
  const scenarioResults: ContinuityScenarioResult[] = [];

  await mkdir(outputRoot, { recursive: true });

  for (const scenario of scenarios) {
    const scenarioRunId = `${runId}_${scenario.id}`;
    const harness = options.harnessFactory
      ? options.harnessFactory({ scenario, runId: scenarioRunId, traceDir, headed })
      : new BrowseGentV2Harness({ runId: scenarioRunId, traceDir, headed });

    scenarioResults.push(await runScenario(scenario, harness));
  }

  const reportPath = join(outputRoot, 'report.json');
  const scenarioResultsPath = join(outputRoot, 'scenario-results.json');
  const report: ContinuityStressReport = {
    runId,
    scenarioCount: scenarioResults.length,
    passedCount: scenarioResults.filter(result => result.status === 'passed').length,
    failedCount: scenarioResults.filter(result => result.status === 'failed').length,
    reportPath,
    scenarioResultsPath,
  };

  await writeJson(reportPath, report);
  await writeJson(scenarioResultsPath, scenarioResults);

  return { report, scenarioResults };
}

async function runScenario(scenario: ContinuityScenario, harness: StressHarness): Promise<ContinuityScenarioResult> {
  let before: BrowserObservation | undefined;
  let after: BrowserObservation | undefined;
  let actionResult: V2ToolResult | undefined;
  let manifest: TraceManifest | undefined;

  try {
    before = await harness.open(fixtureUrl(scenario.fixture));
    actionResult = await executeScenarioAction(scenario, harness, before);
    if (!actionResult.success) {
      throw new StressScenarioError(actionResult.error?.code ?? 'tool_failed', actionResult.error?.message ?? 'Tool execution failed.');
    }
    after = await harness.observe();
    manifest = await harness.flushTrace();

    return {
      scenarioId: scenario.id,
      status: 'passed',
      tracePath: manifest.artifacts.trace.path,
      metrics: buildMetrics(before, after, actionResult, manifest),
    };
  } catch (error) {
    manifest = await flushTraceSafely(harness, manifest);
    const failureType = error instanceof StressScenarioError ? error.failureType : 'scenario_error';
    const failureMessage = error instanceof Error ? error.message : String(error);

    return {
      scenarioId: scenario.id,
      status: 'failed',
      tracePath: manifest?.artifacts.trace.path,
      failureType,
      failureMessage,
      metrics: buildMetrics(before, after, actionResult, manifest),
    };
  } finally {
    await harness.close();
  }
}

async function executeScenarioAction(
  scenario: ContinuityScenario,
  harness: StressHarness,
  observation: BrowserObservation,
): Promise<V2ToolResult> {
  switch (scenario.action.kind) {
    case 'observe':
      await harness.observe();
      return {
        success: true,
        kind: 'observe',
        traceStepId: `observe_${scenario.id}`,
      };
    case 'clickByName': {
      const ref = findRefByName(observation, scenario.action.name);
      if (!ref) {
        throw new StressScenarioError('target_ref_missing', `No ref matched "${scenario.action.name}".`);
      }
      return harness.click(ref.refId);
    }
    case 'typeByName': {
      const ref = findRefByName(observation, scenario.action.name);
      if (!ref) {
        throw new StressScenarioError('target_ref_missing', `No ref matched "${scenario.action.name}".`);
      }
      return harness.type(ref.refId, scenario.action.text);
    }
  }
}

function buildMetrics(
  before: BrowserObservation | undefined,
  after: BrowserObservation | undefined,
  actionResult: V2ToolResult | undefined,
  manifest: TraceManifest | undefined,
): ContinuityScenarioMetrics {
  const traceAudit = manifest
    ? auditTraceReplayJson(manifest, {
        expectedToolExecutions: actionResult && actionResult.kind !== 'observe' ? 1 : 0,
      })
    : undefined;

  return {
    refSurvival: calculateRefSurvival(before, after),
    wrongRefCount: 0,
    transitionClassDistribution: transitionDistribution(actionResult),
    traceComplete: traceAudit?.ok ?? false,
    projectionSize: after?.stats.refCount ?? before?.stats.refCount ?? 0,
  };
}

function calculateRefSurvival(before: BrowserObservation | undefined, after: BrowserObservation | undefined): number {
  if (!before || !after || before.refs.length === 0) {
    return 0;
  }

  const afterIds = new Set(after.refs.map(ref => ref.refId));
  const preserved = before.refs.filter(ref => afterIds.has(ref.refId)).length;
  return preserved / before.refs.length;
}

function transitionDistribution(actionResult: V2ToolResult | undefined): Record<string, number> {
  const transitionClass = actionResult?.evidence?.transitionClass;
  return transitionClass ? { [transitionClass]: 1 } : {};
}

function findRefByName(observation: BrowserObservation, name: string): V2Ref | undefined {
  return observation.refs.find(ref => ref.name === name || ref.text === name);
}

async function flushTraceSafely(harness: StressHarness, existing: TraceManifest | undefined): Promise<TraceManifest | undefined> {
  if (existing) return existing;

  try {
    return await harness.flushTrace();
  } catch {
    return undefined;
  }
}

function fixtureUrl(fixture: string): string {
  return pathToFileURL(resolve('tests/fixtures/v2', fixture)).toString();
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

class StressScenarioError extends Error {
  constructor(readonly failureType: string, message: string) {
    super(message);
    this.name = 'StressScenarioError';
  }
}

if (require.main === module) {
  runContinuityStress()
    .then(result => {
      process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
    })
    .catch(error => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
