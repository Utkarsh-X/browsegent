import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

async function loadAgentSmokeRunner() {
  try {
    return await import('../../eval/v2/run_agent_smoke');
  } catch (error) {
    assert.fail(`expected v2 agent smoke runner module to exist: ${(error as Error).message}`);
  }
}

test('runAgentSmoke writes report and scenario results with trace diagnostics', async () => {
  const { runAgentSmoke } = await loadAgentSmokeRunner();
  const outputRoot = join(process.cwd(), 'logs', 'v2-agent-smoke-unit');
  await rm(outputRoot, { recursive: true, force: true });

  const summary = await runAgentSmoke({
    runId: 'agent_smoke_unit',
    outputRoot,
    scenarios: [
      {
        scenarioId: 'passing',
        fixture: 'static-controls.html',
        goal: 'Read visible controls',
        plannerOutputs: [{ done: true, val: 'ok' }],
        expectedSuccess: true,
      },
      {
        scenarioId: 'failing',
        fixture: 'static-controls.html',
        goal: 'Force failure',
        plannerOutputs: [{ escalate: 'dead_end', reason: 'bounded fake failure' }],
        expectedSuccess: false,
      },
    ],
    loopFactory: (scenario, scenarioRunId) => ({
      run: async () => ({
        success: scenario.expectedSuccess,
        value: scenario.expectedSuccess ? 'ok' : '',
        failureReason: scenario.expectedSuccess ? undefined : 'planner_escalated:dead_end',
        steps: 1,
        tracePath: await writeTrace(outputRoot, 'agent_smoke_unit', scenarioRunId),
        metrics: {
          plannerCalls: 1,
          inputTokens: 2,
          outputTokens: 3,
          plannerDurationMs: 4,
          toolExecutions: 0,
        },
      }),
    }),
  });

  assert.equal(summary.scenarioCount, 2);
  assert.equal(summary.passedCount, 2);
  assert.equal(summary.failedCount, 0);
  assert.equal(summary.traceCompleteCount, 2);
  assert.equal(summary.traceIncompleteCount, 0);

  const report = JSON.parse(await readFile(summary.reportPath, 'utf8'));
  const scenarioResults = JSON.parse(await readFile(summary.scenarioResultsPath, 'utf8'));

  assert.equal(report.runId, 'agent_smoke_unit');
  assert.equal(scenarioResults.length, 2);
  assert.equal(scenarioResults[0].traceComplete, true);
  assert.equal(scenarioResults[0].plannerArtifactCount, 2);
  assert.equal(scenarioResults[0].failedStepCount, 0);
  assert.equal(scenarioResults[1].traceComplete, true);
  assert.equal(scenarioResults[1].plannerArtifactCount, 2);
  assert.equal(scenarioResults[1].failedStepCount, 0);
  assert.equal(scenarioResults[1].traceFailureReason, undefined);
  assert.equal(scenarioResults[1].failureReason, 'planner_escalated:dead_end');
  assert.equal(scenarioResults[1].metrics.toolExecutions, 0);
});

test('runAgentSmoke fails claimed success when runtime trace steps failed', async () => {
  const { runAgentSmoke } = await loadAgentSmokeRunner();
  const outputRoot = join(process.cwd(), 'logs', 'v2-agent-smoke-runtime-failure-unit');
  await rm(outputRoot, { recursive: true, force: true });

  const summary = await runAgentSmoke({
    runId: 'agent_smoke_runtime_failure_unit',
    outputRoot,
    scenarios: [
      {
        scenarioId: 'runtime-failed',
        fixture: 'static-controls.html',
        goal: 'Claim success despite runtime failure',
        plannerOutputs: [{ done: true, val: 'claimed success' }],
        expectedSuccess: true,
      },
    ],
    loopFactory: (_scenario, scenarioRunId) => ({
      run: async () => ({
        success: true,
        value: 'claimed success',
        steps: 1,
        tracePath: await writeTrace(outputRoot, 'agent_smoke_runtime_failure_unit', scenarioRunId, [
          {
            stepId: 'step_1',
            index: 0,
            kind: 'click',
            status: 'failed',
            warnings: [],
            result: { success: false, kind: 'click', targetRef: 'v2ref_1', traceStepId: 'step_1' },
          },
        ]),
        metrics: {
          plannerCalls: 1,
          inputTokens: 2,
          outputTokens: 3,
          plannerDurationMs: 4,
          toolExecutions: 1,
        },
      }),
    }),
  });

  assert.equal(summary.passedCount, 0);
  assert.equal(summary.failedCount, 1);
  assert.equal(summary.traceCompleteCount, 0);
  assert.equal(summary.traceIncompleteCount, 1);

  const scenarioResults = JSON.parse(await readFile(summary.scenarioResultsPath, 'utf8'));

  assert.equal(scenarioResults[0].passed, false);
  assert.equal(scenarioResults[0].traceComplete, false);
  assert.equal(scenarioResults[0].failedStepCount, 1);
  assert.match(scenarioResults[0].traceFailureReason, /failed_runtime_steps/);
});

async function writeTrace(
  outputRoot: string,
  runId: string,
  scenarioRunId: string,
  steps: unknown[] = [],
): Promise<string> {
  const tracePath = join(outputRoot, runId, 'traces', scenarioRunId, 'trace.json');
  await mkdir(dirname(tracePath), { recursive: true });
  await writeFile(tracePath, JSON.stringify({
    artifacts: {
      planner: [
        { kind: 'planner_input', id: 'episode_1-input', path: 'planner/episode_1-input.json' },
        { kind: 'planner_output', id: 'episode_1-output', path: 'planner/episode_1-output.json' },
      ],
      trace: { kind: 'trace', id: 'trace', path: tracePath },
      observations: [{ kind: 'observation', id: 'obs_1_1', path: 'observations/obs_1_1.json' }],
      transitions: [],
      graph: [],
      screenshots: [],
    },
    runId: scenarioRunId,
    runtimeMode: 'agent',
    startTime: 100,
    steps,
  }), 'utf8');
  return tracePath;
}
