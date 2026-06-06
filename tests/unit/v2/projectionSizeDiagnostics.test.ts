import assert from 'node:assert/strict';
import test from 'node:test';
import { measureProjectionSize } from '../../../src/v2/planner/ProjectionSizeDiagnostics';

test('measureProjectionSize reports deterministic utf8 byte counts', () => {
  const diagnostics = measureProjectionSize({
    current: { refs: { r1: { text: 'hello' } } },
    workingSet: { primaryRefs: ['r1'] },
  });

  assert.equal(diagnostics.currentBytes, Buffer.byteLength(JSON.stringify({ refs: { r1: { text: 'hello' } } }), 'utf8'));
  assert.equal(diagnostics.workingSetBytes, Buffer.byteLength(JSON.stringify({ primaryRefs: ['r1'] }), 'utf8'));
  assert.equal(diagnostics.totalPlannerInputBytes, diagnostics.currentBytes + diagnostics.workingSetBytes);
});
