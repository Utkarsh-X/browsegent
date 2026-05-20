import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { toTraceJsonValue } from '../../../src/v2/trace/serialize';
import { TraceStore } from '../../../src/v2/trace/TraceStore';
import { buildBrowserObservation } from '../../../src/v2/substrate/ObservationService';
import type { BrowserObservation, V2Ref } from '../../../src/v2';

function makeRef(overrides: Partial<V2Ref> = {}): V2Ref {
  return {
    refId: 'ref_link',
    generationId: 1,
    targetId: 'target_link',
    selectorCandidates: ['a[href="/docs"]'],
    role: 'link',
    name: 'Docs',
    text: 'Docs',
    visibility: 'visible',
    actionability: 'ready',
    continuityConfidence: 1,
    state: 'live',
    ...overrides,
  };
}

function makeObservation(id: string): BrowserObservation {
  return buildBrowserObservation({
    observationId: id,
    sessionId: 'session_serialization',
    generationId: 1,
    url: 'https://example.test/docs',
    title: 'Docs',
    timestamp: 900,
    durationMs: 4,
    refs: [makeRef()],
    warnings: [],
  });
}

async function freshTraceDir(name: string): Promise<string> {
  const root = join(process.cwd(), 'logs', 'v2-unit-traces', name);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  return root;
}

test('toTraceJsonValue rejects non-serializable browser-like handles instead of silently dropping them', () => {
  assert.throws(
    () => toTraceJsonValue({ page: { click() { return undefined; } } }),
    /not JSON serializable/,
  );
});

test('TraceStore writes deterministic trace JSON for the same recorded runtime facts', async () => {
  const traceDir = await freshTraceDir('deterministic');

  async function writeTrace(runId: string): Promise<string> {
    const store = new TraceStore({
      runId,
      runtimeMode: 'mvr',
      traceDir,
      startTime: 5000,
    });
    const observation = makeObservation('obs_same');
    store.recordObservation(observation);
    const stepId = store.recordActionStart({
      kind: 'inspect_region',
      targetRef: 'ref_link',
      beforeObservationId: observation.observationId,
      timestamp: 5001,
    });
    store.recordActionEnd(stepId, {
      success: true,
      kind: 'inspect_region',
      targetRef: 'ref_link',
      value: 'Docs',
      traceStepId: stepId,
    }, {
      afterObservationId: observation.observationId,
      timestamp: 5002,
    });
    await store.flush();
    return readFile(join(traceDir, runId, 'trace.json'), 'utf8');
  }

  const first = await writeTrace('run_deterministic_a');
  const second = await writeTrace('run_deterministic_a');

  assert.equal(first, second);
});
