import test from 'node:test';
import assert from 'node:assert/strict';
import { LatencyLedger } from '../../../src/v2/trace/LatencyLedger';

test('LatencyLedger records 5 independent categories plus unaccounted', () => {
  const ledger = new LatencyLedger();
  ledger.beginStep(0);
  ledger.recordPhase('local_compute', 45);
  ledger.recordPhase('provider', 1800);
  ledger.recordPhase('browser_interaction', 200);
  ledger.recordPhase('stabilization_wait', 150);
  ledger.recordPhase('observation_capture', 80);
  ledger.endStep(0, 2400);

  const summary = ledger.summarize();
  assert.equal(summary.steps[0].phases.local_compute, 45);
  assert.equal(summary.steps[0].phases.provider, 1800);
  assert.equal(summary.steps[0].phases.browser_interaction, 200);
  assert.equal(summary.steps[0].phases.stabilization_wait, 150);
  assert.equal(summary.steps[0].phases.observation_capture, 80);
  assert.equal(summary.totals.unaccounted, 2400 - (45 + 1800 + 200 + 150 + 80)); // 125ms
  // No browsegent_owned — each category stands alone
  assert.equal(summary.totals.hasOwnProperty('browsegent_owned'), false);
});

test('LatencyLedger accumulates multiple phases within a step', () => {
  const ledger = new LatencyLedger();
  ledger.beginStep(0);
  ledger.recordPhase('local_compute', 10);
  ledger.recordPhase('local_compute', 25);
  ledger.endStep(0, 100);
  assert.equal(ledger.summarize().steps[0].phases.local_compute, 35);
});

test('LatencyLedger aggregates across steps', () => {
  const ledger = new LatencyLedger();
  ledger.beginStep(0);
  ledger.recordPhase('provider', 1000);
  ledger.endStep(0, 1100);
  ledger.beginStep(1);
  ledger.recordPhase('provider', 900);
  ledger.endStep(1, 1000);
  const s = ledger.summarize();
  assert.equal(s.stepCount, 2);
  assert.equal(s.totals.provider, 1900);
  assert.equal(s.totals.total, 2100);
});

test('LatencyLedger rejects a new step while the previous step is still active', () => {
  const ledger = new LatencyLedger();
  ledger.beginStep(0);
  ledger.recordPhase('provider', 1000);

  assert.throws(() => ledger.beginStep(1), /active latency step 0/);

  ledger.endStep(0, 1100);
  assert.equal(ledger.summarize().stepCount, 1);
});

test('LatencyLedger.closeActiveStep finalizes dangling step on early return', () => {
  const ledger = new LatencyLedger();
  ledger.beginStep(0);
  ledger.recordPhase('provider', 500);
  // Simulate early return — step not ended via endStep
  ledger.closeActiveStep();
  const s = ledger.summarize();
  assert.equal(s.stepCount, 1);
  assert.ok(s.steps[0].totalMs >= 0);
  assert.equal(s.steps[0].phases.provider, 500);
});

test('LatencyLedger.toJSON returns serializable summary', () => {
  const ledger = new LatencyLedger();
  const json = JSON.stringify(ledger);
  assert.ok(json);
  const parsed = JSON.parse(json);
  assert.equal(parsed.stepCount, 0);
  assert.ok(parsed.totals);
});

test('LatencyLedger recordPhase is no-op without active step', () => {
  const ledger = new LatencyLedger();
  // No beginStep called — recordPhase should silently do nothing
  ledger.recordPhase('provider', 1000);
  const s = ledger.summarize();
  assert.equal(s.stepCount, 0);
  assert.equal(s.totals.provider, 0);
});

test('LatencyLedger endStep ignores mismatched stepIndex', () => {
  const ledger = new LatencyLedger();
  ledger.beginStep(0);
  ledger.recordPhase('provider', 500);
  ledger.endStep(99, 1000); // wrong stepIndex — ignored
  // Step is still active, close it
  ledger.closeActiveStep();
  const s = ledger.summarize();
  assert.equal(s.stepCount, 1);
  assert.equal(s.steps[0].phases.provider, 500);
});
