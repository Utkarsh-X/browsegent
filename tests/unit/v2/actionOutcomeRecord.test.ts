import test from 'node:test';
import assert from 'node:assert/strict';
import { ActionOutcomeRecorder } from '../../../src/v2/trace/ActionOutcomeRecord';

test('dispatched click with state change does NOT set readEvidenceProduced', () => {
  const recorder = new ActionOutcomeRecorder();
  recorder.record({
    stepIndex: 0, tool: 'click', targetRef: 'v2ref_1', source: 'dispatch',
    success: true, stateChanged: true, readEvidenceProduced: false,
  });
  assert.equal(recorder.getOutcomes()[0].readEvidenceProduced, false);
});

test('dispatched get with text sets readEvidenceProduced', () => {
  const recorder = new ActionOutcomeRecorder();
  recorder.record({
    stepIndex: 0, tool: 'get', targetRef: 'v2ref_2', source: 'dispatch',
    success: true, stateChanged: false, readEvidenceProduced: true,
  });
  assert.equal(recorder.getOutcomes()[0].readEvidenceProduced, true);
});

test('dispatched search_page with empty text does NOT set readEvidenceProduced', () => {
  const recorder = new ActionOutcomeRecorder();
  recorder.record({
    stepIndex: 0, tool: 'search_page', source: 'dispatch',
    success: true, stateChanged: false, readEvidenceProduced: false,
  });
  assert.equal(recorder.getOutcomes()[0].readEvidenceProduced, false);
});

test('pre-execution rejection records source and error', () => {
  const recorder = new ActionOutcomeRecorder();
  recorder.record({
    stepIndex: 1, tool: 'navigate', source: 'pre_execution_guard',
    success: false, errorCode: 'invalid_action_payload',
    stateChanged: false, readEvidenceProduced: false,
  });
  assert.equal(recorder.getOutcomes()[0].source, 'pre_execution_guard');
  assert.equal(recorder.getOutcomes()[0].errorCode, 'invalid_action_payload');
});

test('hard-block rejection records source', () => {
  const recorder = new ActionOutcomeRecorder();
  recorder.record({
    stepIndex: 2, tool: 'click', targetRef: 'v2ref_5', source: 'hard_block',
    success: false, errorCode: 'action_blocked_by_loop_detector',
    stateChanged: false, readEvidenceProduced: false,
  });
  assert.equal(recorder.getOutcomes()[0].source, 'hard_block');
});

test('summary counts are correct', () => {
  const recorder = new ActionOutcomeRecorder();
  recorder.record({ stepIndex: 0, tool: 'click', source: 'dispatch', success: true, stateChanged: true, readEvidenceProduced: false });
  recorder.record({ stepIndex: 1, tool: 'get', source: 'dispatch', success: true, stateChanged: false, readEvidenceProduced: true });
  recorder.record({ stepIndex: 2, tool: 'navigate', source: 'pre_execution_guard', success: false, errorCode: 'invalid_action_payload', stateChanged: false, readEvidenceProduced: false });
  recorder.record({ stepIndex: 3, tool: 'click', source: 'dispatch', success: true, stateChanged: false, readEvidenceProduced: false });

  const summary = recorder.summary();
  assert.equal(summary.total, 4);
  assert.equal(summary.dispatched, 3);
  assert.equal(summary.preExecutionRejected, 1);
  assert.equal(summary.stateChanging, 1);
  assert.equal(summary.evidenceProducing, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.noEffect, 1); // step 3: dispatched + success + no state change + no evidence
});

test('toJSON returns serializable summary', () => {
  const recorder = new ActionOutcomeRecorder();
  recorder.record({ stepIndex: 0, tool: 'click', source: 'dispatch', success: true, stateChanged: false, readEvidenceProduced: false });
  const json = JSON.parse(JSON.stringify(recorder));
  assert.ok(json.outcomes);
  assert.ok(json.summary);
  assert.equal(json.summary.total, 1);
});
