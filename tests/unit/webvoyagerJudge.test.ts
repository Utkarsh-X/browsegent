import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseJudgeVerdict, buildJudgeUserPrompt, collectFinalPageEvidence } from '../../tests/benchmark/webvoyager/judge';
import { evaluateWebVoyagerResult, summarizeWebVoyagerEvaluation } from '../../tests/benchmark/webvoyager/evaluator';
import type { WebVoyagerBenchmarkTask, WebVoyagerVerdict } from '../../tests/benchmark/webvoyager/types';
import type { ScoredBenchmarkResult } from '../../tests/benchmark/v2/types';

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

test('collectFinalPageEvidence leads with goal-relevant lines instead of DOM-order chrome', () => {
  const traceDir = mkdtempSync(join(tmpdir(), 'judge-evidence-'));
  try {
    const observationsDir = join(traceDir, 'observations');
    mkdirSync(observationsDir, { recursive: true });
    const chrome = Array.from({ length: 60 }, (_, index) => ({
      refId: `chrome_${index}`, role: 'link', name: `Nav item ${index}`, text: `Nav item ${index}`,
    }));
    const content = [
      { refId: 'result_row', role: 'link', name: 'resource-watch/resource-watch', text: 'resource-watch/resource-watch 73 stars' },
      { refId: 'sort_control', role: 'button', name: 'Sort by: Best match', text: 'Sort by: Best match' },
    ];
    // Exactly one observation; DOM order puts all chrome before the content.
    writeFileSync(join(observationsDir, 'obs_1_1.json'), `${JSON.stringify({ refs: [...chrome, ...content] }, null, 2)}\n`, 'utf8');

    const withGoal = collectFinalPageEvidence(traceDir, 12, 120, 'Which climate visualization repository has the most stars?');
    assert.ok(withGoal.includes('resource-watch/resource-watch 73 stars'), 'goal-relevant row must be included');
    assert.ok(!withGoal.includes('Nav item 59'), 'chrome is displaced by goal-relevant content');

    const noGoal = collectFinalPageEvidence(traceDir, 12, 120);
    assert.ok(noGoal.includes('Nav item 0'), 'without a goal the excerpt stays in DOM order');
    assert.ok(!noGoal.includes('resource-watch'), 'small budget keeps DOM-order truncation without goal guidance');
  } finally {
    rmSync(traceDir, { recursive: true, force: true });
  }
});

test('collectFinalPageEvidence dedupes repeated chrome lines and caps line length', () => {
  const traceDir = mkdtempSync(join(tmpdir(), 'judge-evidence-dedupe-'));
  try {
    const observationsDir = join(traceDir, 'observations');
    mkdirSync(observationsDir, { recursive: true });
    const refs = Array.from({ length: 5 }, (_, index) => ({
      refId: `dup_${index}`, role: 'link', name: 'Homepage', text: 'Homepage',
    }));
    writeFileSync(join(observationsDir, 'obs_1_1.json'), `${JSON.stringify({ refs }, null, 2)}\n`, 'utf8');

    const evidence = collectFinalPageEvidence(traceDir, 40, 120);
    assert.equal(evidence.split('\n').filter(line => line === 'link: Homepage').length, 1, 'identical lines collapse');
  } finally {
    rmSync(traceDir, { recursive: true, force: true });
  }
});
