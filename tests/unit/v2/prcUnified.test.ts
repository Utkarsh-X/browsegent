import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePlannerSerializationConfig } from '../../../src/v2/planner/types';
import { V2PlannerClient } from '../../../src/v2/planner/V2PlannerClient';

test('resolvePlannerSerializationConfig returns json mode for undefined or empty input', () => {
  assert.deepEqual(resolvePlannerSerializationConfig(undefined), { mode: 'json' });
  assert.deepEqual(resolvePlannerSerializationConfig({ mode: 'json' }), { mode: 'json' });
});

test('resolvePlannerSerializationConfig preserves un-unified prc mode without mutation', () => {
  assert.deepEqual(resolvePlannerSerializationConfig({ mode: 'prc' }), { mode: 'prc' });
});

test('resolvePlannerSerializationConfig expands prcUnified to all 6 proven features', () => {
  const resolved = resolvePlannerSerializationConfig({ mode: 'prc', prcUnified: true });

  assert.equal(resolved.mode, 'prc');
  assert.equal(resolved.prcUnified, true);
  assert.equal(resolved.prcLeanPlane, true);
  assert.equal(resolved.conditionalSystemPrompt, true);
  assert.equal(resolved.composedPrompt, true);
  assert.equal(resolved.pageModel, true);
  assert.equal(resolved.doneCandidateChecklist, true);
  assert.equal(resolved.deltaSurface, true);
});

test('resolvePlannerSerializationConfig respects explicit overrides when prcUnified is true', () => {
  const resolved = resolvePlannerSerializationConfig({
    mode: 'prc',
    prcUnified: true,
    pageModel: false,
    doneCandidateChecklist: false,
  });

  assert.equal(resolved.mode, 'prc');
  assert.equal(resolved.prcUnified, true);
  assert.equal(resolved.prcLeanPlane, true);
  assert.equal(resolved.conditionalSystemPrompt, true);
  assert.equal(resolved.composedPrompt, true);
  assert.equal(resolved.pageModel, false);
  assert.equal(resolved.doneCandidateChecklist, false);
  assert.equal(resolved.deltaSurface, true);
});

test('V2PlannerClient initializes resolved unified config correctly', () => {
  const client = new V2PlannerClient({
    plannerSerialization: { mode: 'prc', prcUnified: true },
  });

  // Client should construct without errors and reflect unified configuration internally
  assert.ok(client);
});

test('readPlannerSerializationConfig with --prc-unified flag expands to full unified stack', async () => {
  const { readPlannerSerializationConfig, readPlannerSerializationArg } = await import('../../benchmark/webvoyager/run_webvoyager_lite');
  const savedArgv = [...process.argv];

  try {
    process.argv = ['node', 'run_webvoyager_lite.ts', '--planner-serialization', 'prc', '--prc-unified'];
    const mode = readPlannerSerializationArg();
    assert.equal(mode, 'prc');
    const config = readPlannerSerializationConfig(mode);
    assert.equal(config?.mode, 'prc');
    assert.equal(config?.prcUnified, true);
    assert.equal(config?.prcLeanPlane, true);
    assert.equal(config?.conditionalSystemPrompt, true);
    assert.equal(config?.composedPrompt, true);
    assert.equal(config?.pageModel, true);
    assert.equal(config?.doneCandidateChecklist, true);
    assert.equal(config?.deltaSurface, true);
  } finally {
    process.argv = savedArgv;
  }
});

test('readPlannerSerializationConfig with --planner-serialization prc-unified expands to full unified stack', async () => {
  const { readPlannerSerializationConfig, readPlannerSerializationArg } = await import('../../benchmark/webvoyager/run_webvoyager_lite');
  const savedArgv = [...process.argv];

  try {
    process.argv = ['node', 'run_webvoyager_lite.ts', '--planner-serialization', 'prc-unified'];
    const mode = readPlannerSerializationArg();
    assert.equal(mode, 'prc');
    const config = readPlannerSerializationConfig(mode);
    assert.equal(config?.mode, 'prc');
    assert.equal(config?.prcUnified, true);
    assert.equal(config?.prcLeanPlane, true);
    assert.equal(config?.conditionalSystemPrompt, true);
    assert.equal(config?.composedPrompt, true);
    assert.equal(config?.pageModel, true);
    assert.equal(config?.doneCandidateChecklist, true);
    assert.equal(config?.deltaSurface, true);
  } finally {
    process.argv = savedArgv;
  }
});

test('readPlannerSerializationConfig with bare --prc-unified expands to full unified stack without needing explicit mode', async () => {
  const { readPlannerSerializationConfig, readPlannerSerializationArg } = await import('../../benchmark/webvoyager/run_webvoyager_lite');
  const savedArgv = [...process.argv];

  try {
    process.argv = ['node', 'run_webvoyager_lite.ts', '--prc-unified'];
    const mode = readPlannerSerializationArg();
    assert.equal(mode, undefined);
    const config = readPlannerSerializationConfig(mode);
    assert.equal(config?.mode, 'prc');
    assert.equal(config?.prcUnified, true);
    assert.equal(config?.prcLeanPlane, true);
    assert.equal(config?.conditionalSystemPrompt, true);
    assert.equal(config?.composedPrompt, true);
    assert.equal(config?.pageModel, true);
    assert.equal(config?.doneCandidateChecklist, true);
    assert.equal(config?.deltaSurface, true);
  } finally {
    process.argv = savedArgv;
  }
});
