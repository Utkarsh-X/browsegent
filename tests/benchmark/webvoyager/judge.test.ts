import test from 'node:test';
import assert from 'node:assert/strict';

import { parseJudgeVerdict, buildJudgeUserPrompt } from './judge';
import { evaluateWebVoyagerResult, summarizeWebVoyagerEvaluation } from './evaluator';
import type { WebVoyagerBenchmarkTask, WebVoyagerVerdict } from './types';
import type { ScoredBenchmarkResult } from '../v2/types';

test('parseJudgeVerdict reads the final verdict line and is robust to reasoning text', () => {
  assert.equal(parseJudgeVerdict('The task seems done.\nVERDICT: SUCCESS'), 'SUCCESS');
  assert.equal(parseJudgeVerdict('VERDICT: NOT SUCCESS\nlater musing VERDICT: NOT SUCCESS'), 'NOT_SUCCESS');
  assert.equal(parseJudgeVerdict('no verdict here'), 'UNAVAILABLE');
});

test('buildJudgeUserPrompt frames the reference as a hint, not a containment target', () => {
  const prompt = buildJudgeUserPrompt({
    goal: 'Find a Mexico hotel with deals for December 25-26',
    referenceHint: 'Be Local',
    agentAnswer: 'Hotel Flamencos Centro Histórico is available',
    finalUrl: 'https://www.booking.com/searchresults.html',
    pageEvidence: 'button: खोजें\ncheckbox: 25 December 2026',
  });
  assert.match(prompt, /TASK: Find a Mexico hotel/);
  assert.match(prompt, /Reference Hint/);
  assert.match(prompt, /live results may legitimately differ/);
  assert.match(prompt, /Hotel Flamencos/);
  assert.match(prompt, /खोजें/);
});

function makeTask(taskId: string): WebVoyagerBenchmarkTask {
  return {
    taskId,
    goal: 'goal',
    startUrl: 'https://example.test',
    maxSteps: 8,
    webVoyager: {
      referenceAnswer: { answer: 'Be Local', type: 'possible' },
    },
  } as unknown as WebVoyagerBenchmarkTask;
}

function makeResult(passed: boolean, value: string): ScoredBenchmarkResult {
  return {
    taskId: 'webvoyager_Booking__0',
    attempt: 1,
    success: passed,
    value,
    partition: { name: 'balanced30' },
    passed,
    validation: { ok: true, errors: [] },
    trace: { score: 1, reasons: [] },
    metrics: {},
  } as unknown as ScoredBenchmarkResult;
}

test('evaluateWebVoyagerResult attaches judge fields without touching strictScore', () => {
  const task = makeTask('webvoyager_Booking__0');
  const result = makeResult(true, 'Hotel Flamencos Centro Histórico is available');
  const verdict: WebVoyagerVerdict = evaluateWebVoyagerResult(task, result, undefined, {
    score: 1,
    verdict: 'SUCCESS',
    reason: 'the answer names a live result',
  });

  assert.equal(verdict.strictScore, 0, 'the string matcher is untouched');
  assert.equal(verdict.judgeScore, 1);
  assert.equal(verdict.judgeVerdict, 'SUCCESS');
  assert.equal(verdict.judgeReason, 'the answer names a live result');
});

test('summary computes judge rates only over judged tasks', () => {
  const task = makeTask('webvoyager_Booking__0');
  const judged = evaluateWebVoyagerResult(task, makeResult(true, 'answer a'), undefined, { score: 1, verdict: 'SUCCESS' });
  const judgedFail = evaluateWebVoyagerResult(task, makeResult(true, 'answer b'), undefined, { score: 0, verdict: 'NOT_SUCCESS' });
  const unjudged = evaluateWebVoyagerResult(task, makeResult(true, 'answer c'));
  const summary = summarizeWebVoyagerEvaluation([judged, judgedFail, unjudged]);

  assert.equal(summary.judgedCount, 2);
  assert.equal(summary.judgeScoreRate, 0.5);
});
