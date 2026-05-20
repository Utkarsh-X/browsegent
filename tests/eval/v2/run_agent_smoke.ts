import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { auditTraceReplay, V2AgentLoop, type PlannerInput, type PlannerOutput, type V2AgentLoopResult, type V2PlannerClientLike } from '../../../src/v2';
import { AGENT_SMOKE_SCENARIOS, type AgentSmokeScenario } from './agent_smoke_scenarios';

export interface AgentSmokeLoopLike {
  run(input: { url: string; goal: string; maxSteps: number; model?: string }): Promise<V2AgentLoopResult>;
}

export interface AgentSmokeRunOptions {
  runId?: string;
  outputRoot?: string;
  scenarios?: AgentSmokeScenario[];
  model?: string;
  loopFactory?: (scenario: AgentSmokeScenario, scenarioRunId: string) => AgentSmokeLoopLike;
}

export interface AgentSmokeScenarioResult {
  scenarioId: string;
  fixture: string;
  goal: string;
  expectedSuccess: boolean;
  success: boolean;
  passed: boolean;
  value: string;
  failureReason?: string;
  tracePath?: string;
  traceComplete: boolean;
  plannerArtifactCount: number;
  runtimeStepCount: number;
  failedStepCount: number;
  traceFailureReason?: string;
  metrics: V2AgentLoopResult['metrics'];
}

export interface AgentSmokeSummary {
  runId: string;
  scenarioCount: number;
  passedCount: number;
  failedCount: number;
  traceCompleteCount: number;
  traceIncompleteCount: number;
  reportPath: string;
  scenarioResultsPath: string;
}

export async function runAgentSmoke(options: AgentSmokeRunOptions = {}): Promise<AgentSmokeSummary> {
  const runId = options.runId ?? `agent_smoke_${Date.now()}`;
  const outputRoot = options.outputRoot ?? join(process.cwd(), 'logs', 'v2-agent-smoke');
  const runRoot = join(outputRoot, runId);
  const scenarios = options.scenarios ?? AGENT_SMOKE_SCENARIOS;
  const results: AgentSmokeScenarioResult[] = [];

  await mkdir(runRoot, { recursive: true });

  for (const scenario of scenarios) {
    const scenarioRunId = `${runId}_${scenario.scenarioId}`;
    const loop = options.loopFactory?.(scenario, scenarioRunId) ?? new V2AgentLoop({
      headed: false,
      runId: scenarioRunId,
      traceDir: join(runRoot, 'traces'),
      plannerClient: new ScriptedPlannerClient(scenario.plannerOutputs),
    });
    const result = await loop.run({
      url: pathToFileURL(resolve('tests/fixtures/v2', scenario.fixture)).toString(),
      goal: scenario.goal,
      maxSteps: scenario.maxSteps ?? 4,
      model: options.model,
    });
    const traceDiagnostics = await readTraceDiagnostics(result.tracePath, result.metrics);
    const passed = result.success === scenario.expectedSuccess && traceDiagnostics.traceComplete;

    results.push({
      scenarioId: scenario.scenarioId,
      fixture: scenario.fixture,
      goal: scenario.goal,
      expectedSuccess: scenario.expectedSuccess,
      success: result.success,
      passed,
      value: result.value,
      failureReason: result.failureReason,
      tracePath: result.tracePath,
      traceComplete: traceDiagnostics.traceComplete,
      plannerArtifactCount: traceDiagnostics.plannerArtifactCount,
      runtimeStepCount: traceDiagnostics.runtimeStepCount,
      failedStepCount: traceDiagnostics.failedStepCount,
      traceFailureReason: traceDiagnostics.traceFailureReason,
      metrics: result.metrics,
    });
  }

  const reportPath = join(runRoot, 'report.json');
  const scenarioResultsPath = join(runRoot, 'scenario-results.json');
  const passedCount = results.filter(result => result.passed).length;
  const traceCompleteCount = results.filter(result => result.traceComplete).length;
  const summary: AgentSmokeSummary = {
    runId,
    scenarioCount: results.length,
    passedCount,
    failedCount: results.length - passedCount,
    traceCompleteCount,
    traceIncompleteCount: results.length - traceCompleteCount,
    reportPath,
    scenarioResultsPath,
  };

  await writeFile(reportPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  await writeFile(scenarioResultsPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8');

  return summary;
}

async function readTraceDiagnostics(
  tracePath: string | undefined,
  expectedMetrics: V2AgentLoopResult['metrics'],
): Promise<{
  traceComplete: boolean;
  plannerArtifactCount: number;
  runtimeStepCount: number;
  failedStepCount: number;
  traceFailureReason?: string;
}> {
  if (!tracePath) {
    return {
      traceComplete: false,
      plannerArtifactCount: 0,
      runtimeStepCount: 0,
      failedStepCount: 0,
      traceFailureReason: 'missing_trace_path',
    };
  }

  const audit = await auditTraceReplay({
    tracePath,
    expectedPlannerCalls: Math.max(1, expectedMetrics.plannerCalls),
    expectedToolExecutions: expectedMetrics.toolExecutions,
    requireAgentMode: true,
  });

  return {
    traceComplete: audit.ok,
    plannerArtifactCount: audit.plannerInputCount + audit.plannerOutputCount,
    runtimeStepCount: audit.runtimeStepCount,
    failedStepCount: audit.failedStepCount,
    traceFailureReason: audit.errors.length > 0 ? audit.errors.join(';') : undefined,
  };
}

class ScriptedPlannerClient implements V2PlannerClientLike {
  private readonly outputs: PlannerOutput[];

  constructor(outputs: PlannerOutput[]) {
    this.outputs = [...outputs];
  }

  async call(input: { plannerInput: PlannerInput }): Promise<{
    output: PlannerOutput;
    rawText: string;
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
  }> {
    const output = this.outputs.shift() ?? { escalate: 'dead_end', reason: 'scripted planner exhausted' };
    const rawText = JSON.stringify(output);

    return {
      output,
      rawText,
      inputTokens: JSON.stringify(input.plannerInput).length,
      outputTokens: rawText.length,
      durationMs: 0,
    };
  }
}

if (require.main === module) {
  runAgentSmoke()
    .then(summary => {
      console.log(JSON.stringify(summary, null, 2));
    })
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
}
