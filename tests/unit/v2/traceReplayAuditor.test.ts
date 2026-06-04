import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

async function loadTraceReplayAuditor() {
  try {
    return await import('../../../src/v2/trace/TraceReplayAuditor');
  } catch (error) {
    assert.fail(`expected TraceReplayAuditor module to exist: ${(error as Error).message}`);
  }
}

test('auditTraceReplay accepts complete agent trace evidence', async () => {
  const { auditTraceReplay } = await loadTraceReplayAuditor();
  const tracePath = await writeTrace('complete', {
    artifacts: {
      trace: { kind: 'trace', id: 'trace', path: 'trace.json' },
      observations: [{ kind: 'observation', id: 'obs_1', path: 'obs_1.json' }],
      planner: [
        { kind: 'planner_input', id: 'episode_1-input', path: 'episode_1-input.json' },
        { kind: 'planner_output', id: 'episode_1-output', path: 'episode_1-output.json' },
      ],
      transitions: [],
      graph: [],
      screenshots: [],
    },
    runtimeMode: 'agent',
    steps: [
      {
        kind: 'click',
        status: 'completed',
        afterObservationId: 'obs_2',
        result: {
          evidence: {
            beforeObservationId: 'obs_1',
            afterObservationId: 'obs_2',
            transitionClass: 'structural_local',
          },
        },
      },
    ],
  });

  const result = await auditTraceReplay({
    tracePath,
    expectedPlannerCalls: 1,
    expectedToolExecutions: 1,
    requireAgentMode: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.plannerInputCount, 1);
  assert.equal(result.plannerOutputCount, 1);
  assert.equal(result.runtimeStepCount, 1);
  assert.equal(result.failedStepCount, 0);
  assert.deepEqual(result.errors, []);
});

test('auditTraceReplay rejects missing planner output artifacts', async () => {
  const { auditTraceReplay } = await loadTraceReplayAuditor();
  const tracePath = await writeTrace('missing-planner-output', {
    artifacts: {
      trace: { kind: 'trace', id: 'trace', path: 'trace.json' },
      observations: [{ kind: 'observation', id: 'obs_1', path: 'obs_1.json' }],
      planner: [{ kind: 'planner_input', id: 'episode_1-input', path: 'episode_1-input.json' }],
      transitions: [],
      graph: [],
      screenshots: [],
    },
    runtimeMode: 'agent',
    steps: [],
  });

  const result = await auditTraceReplay({ tracePath, expectedPlannerCalls: 1, requireAgentMode: true });

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ['missing_planner_output_artifacts']);
});

test('auditTraceReplay rejects failed runtime steps', async () => {
  const { auditTraceReplay } = await loadTraceReplayAuditor();
  const tracePath = await writeTrace('failed-runtime-step', {
    artifacts: {
      trace: { kind: 'trace', id: 'trace', path: 'trace.json' },
      observations: [{ kind: 'observation', id: 'obs_1', path: 'obs_1.json' }],
      planner: [
        { kind: 'planner_input', id: 'episode_1-input', path: 'episode_1-input.json' },
        { kind: 'planner_output', id: 'episode_1-output', path: 'episode_1-output.json' },
      ],
      transitions: [],
      graph: [],
      screenshots: [],
    },
    runtimeMode: 'agent',
    steps: [{ kind: 'click', status: 'failed', result: { success: false } }],
  });

  const result = await auditTraceReplay({ tracePath, expectedPlannerCalls: 1, expectedToolExecutions: 1 });

  assert.equal(result.ok, false);
  assert.equal(result.failedStepCount, 1);
  assert.ok(result.errors.includes('failed_runtime_steps'));
});

test('auditTraceReplay accepts replayable failed runtime steps only when explicitly allowed', async () => {
  const { auditTraceReplay } = await loadTraceReplayAuditor();
  const tracePath = await writeTrace('replayable-failed-runtime-step', {
    artifacts: {
      trace: { kind: 'trace', id: 'trace', path: 'trace.json' },
      observations: [
        { kind: 'observation', id: 'obs_1', path: 'obs_1.json' },
        { kind: 'observation', id: 'obs_2', path: 'obs_2.json' },
      ],
      planner: [
        { kind: 'planner_input', id: 'episode_1-input', path: 'episode_1-input.json' },
        { kind: 'planner_output', id: 'episode_1-output', path: 'episode_1-output.json' },
      ],
      transitions: [],
      graph: [],
      screenshots: [],
    },
    runtimeMode: 'agent',
    steps: [{
      kind: 'click',
      status: 'failed',
      afterObservationId: 'obs_2',
      result: {
        success: false,
        error: { code: 'target_blocked', message: 'blocked', retryable: false },
        evidence: {
          beforeObservationId: 'obs_1',
          afterObservationId: 'obs_2',
          transitionClass: 'microstate',
          strength: 'none',
        },
      },
    }],
  });

  const strictResult = await auditTraceReplay({ tracePath, expectedPlannerCalls: 1, expectedToolExecutions: 1 });
  const benchmarkResult = await auditTraceReplay({
    tracePath,
    expectedPlannerCalls: 1,
    expectedToolExecutions: 1,
    allowFailedRuntimeSteps: true,
  });

  assert.equal(strictResult.ok, false);
  assert.ok(strictResult.errors.includes('failed_runtime_steps'));
  assert.equal(benchmarkResult.ok, true);
  assert.equal(benchmarkResult.failedStepCount, 1);
  assert.deepEqual(benchmarkResult.errors, []);
});

test('auditTraceReplay rejects completed mutation without transition evidence', async () => {
  const { auditTraceReplay } = await loadTraceReplayAuditor();
  const tracePath = await writeTrace('missing-mutation-evidence', {
    artifacts: {
      trace: { kind: 'trace', id: 'trace', path: 'trace.json' },
      observations: [{ kind: 'observation', id: 'obs_1', path: 'obs_1.json' }],
      planner: [
        { kind: 'planner_input', id: 'episode_1-input', path: 'episode_1-input.json' },
        { kind: 'planner_output', id: 'episode_1-output', path: 'episode_1-output.json' },
      ],
      transitions: [],
      graph: [],
      screenshots: [],
    },
    runtimeMode: 'agent',
    steps: [{ kind: 'click', status: 'completed', result: { success: true } }],
  });

  const result = await auditTraceReplay({ tracePath, expectedPlannerCalls: 1, expectedToolExecutions: 1 });

  assert.equal(result.ok, false);
  assert.equal(result.mutationWithoutEvidenceCount, 1);
  assert.ok(result.errors.includes('missing_mutation_evidence'));
});

test('auditTraceReplay treats navigation as a mutation requiring transition evidence', async () => {
  const { auditTraceReplay } = await loadTraceReplayAuditor();
  const tracePath = await writeTrace('navigate-missing-mutation-evidence', {
    artifacts: {
      trace: { kind: 'trace', id: 'trace', path: 'trace.json' },
      observations: [{ kind: 'observation', id: 'obs_1', path: 'obs_1.json' }],
      planner: [
        { kind: 'planner_input', id: 'episode_1-input', path: 'episode_1-input.json' },
        { kind: 'planner_output', id: 'episode_1-output', path: 'episode_1-output.json' },
      ],
      transitions: [],
      graph: [],
      screenshots: [],
    },
    runtimeMode: 'agent',
    steps: [{
      kind: 'navigate',
      status: 'completed',
      result: { success: true, value: { url: 'https://example.test/next' } },
    }],
  });

  const result = await auditTraceReplay({ tracePath, expectedPlannerCalls: 1, expectedToolExecutions: 1 });

  assert.equal(result.ok, false);
  assert.equal(result.mutationWithoutEvidenceCount, 1);
  assert.ok(result.errors.includes('missing_mutation_evidence'));
});

test('auditTraceReplay does not require mutation evidence for failed steps when allowFailedRuntimeSteps is true', async () => {
  const { auditTraceReplay } = await loadTraceReplayAuditor();
  const tracePath = await writeTrace('failed-click-no-evidence-allowed', {
    artifacts: {
      trace: { kind: 'trace', id: 'trace', path: 'trace.json' },
      observations: [{ kind: 'observation', id: 'obs_1', path: 'obs_1.json' }],
      planner: [
        { kind: 'planner_input', id: 'episode_1-input', path: 'episode_1-input.json' },
        { kind: 'planner_output', id: 'episode_1-output', path: 'episode_1-output.json' },
      ],
      transitions: [],
      graph: [],
      screenshots: [],
    },
    runtimeMode: 'agent',
    steps: [
      {
        kind: 'click',
        status: 'completed',
        afterObservationId: 'obs_2',
        result: {
          success: true,
          evidence: {
            beforeObservationId: 'obs_1',
            afterObservationId: 'obs_2',
            transitionClass: 'structural_local',
          },
        },
      },
      {
        kind: 'click',
        status: 'failed',
        result: { success: false, error: { code: 'low_confidence_ref', message: 'low confidence' } },
      },
    ],
  });

  const result = await auditTraceReplay({
    tracePath,
    expectedPlannerCalls: 1,
    expectedToolExecutions: 2,
    allowFailedRuntimeSteps: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.failedStepCount, 1);
  assert.equal(result.mutationWithoutEvidenceCount, 0);
  assert.deepEqual(result.errors, []);
});

test('auditTraceReplay still requires mutation evidence for completed steps even when allowFailedRuntimeSteps is true', async () => {
  const { auditTraceReplay } = await loadTraceReplayAuditor();
  const tracePath = await writeTrace('completed-click-no-evidence', {
    artifacts: {
      trace: { kind: 'trace', id: 'trace', path: 'trace.json' },
      observations: [{ kind: 'observation', id: 'obs_1', path: 'obs_1.json' }],
      planner: [
        { kind: 'planner_input', id: 'episode_1-input', path: 'episode_1-input.json' },
        { kind: 'planner_output', id: 'episode_1-output', path: 'episode_1-output.json' },
      ],
      transitions: [],
      graph: [],
      screenshots: [],
    },
    runtimeMode: 'agent',
    steps: [{ kind: 'click', status: 'completed', result: { success: true } }],
  });

  const result = await auditTraceReplay({
    tracePath,
    expectedPlannerCalls: 1,
    expectedToolExecutions: 1,
    allowFailedRuntimeSteps: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.mutationWithoutEvidenceCount, 1);
  assert.ok(result.errors.includes('missing_mutation_evidence'));
});

test('auditTraceReplay rejects failed click without evidence when allowFailedRuntimeSteps is not set', async () => {
  const { auditTraceReplay } = await loadTraceReplayAuditor();
  const tracePath = await writeTrace('failed-click-no-evidence-strict', {
    artifacts: {
      trace: { kind: 'trace', id: 'trace', path: 'trace.json' },
      observations: [{ kind: 'observation', id: 'obs_1', path: 'obs_1.json' }],
      planner: [
        { kind: 'planner_input', id: 'episode_1-input', path: 'episode_1-input.json' },
        { kind: 'planner_output', id: 'episode_1-output', path: 'episode_1-output.json' },
      ],
      transitions: [],
      graph: [],
      screenshots: [],
    },
    runtimeMode: 'agent',
    steps: [
      {
        kind: 'click',
        status: 'failed',
        result: { success: false, error: { code: 'low_confidence_ref', message: 'low confidence' } },
      },
    ],
  });

  const result = await auditTraceReplay({ tracePath, expectedPlannerCalls: 1, expectedToolExecutions: 1 });

  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('failed_runtime_steps'));
  assert.ok(result.errors.includes('missing_mutation_evidence'));
});

async function writeTrace(name: string, trace: unknown): Promise<string> {
  const tracePath = join(process.cwd(), 'logs', 'v2-trace-auditor-unit', name, 'trace.json');
  await rm(dirname(tracePath), { recursive: true, force: true });
  await mkdir(dirname(tracePath), { recursive: true });
  await writeFile(tracePath, `${JSON.stringify(trace, null, 2)}\n`, 'utf8');
  return tracePath;
}
