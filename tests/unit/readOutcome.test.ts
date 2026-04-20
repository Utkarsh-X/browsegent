import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyReadOutcome, extractAnswerCandidate } from '../../src/agent/readOutcome';
import type { Action } from '../../src/executor/types';
import type { ActionHistoryEntry } from '../../src/graph/serializer';

function makeAction(kind: Action['kind'], target?: string): Action {
  return {
    kind,
    target,
    origin: 'llm',
    original: { tool: kind, sel: target },
  };
}

test('classifyReadOutcome marks direct get as answer evidence', () => {
  const assessment = classifyReadOutcome({
    action: makeAction('get', '#headline'),
    value: 'NASA launches new mission',
    goal: 'What is the headline?',
    history: [],
    graphFingerprint: 'abc',
  });

  assert.equal(assessment.outcome, 'answer_evidence');
  assert.equal(assessment.sameValueCount, 1);
});

test('classifyReadOutcome marks missing region as noise repeat', () => {
  const assessment = classifyReadOutcome({
    action: makeAction('inspect_region', '.results'),
    value: 'Region not found: .results',
    goal: 'Get the first laptop price',
    history: [],
    graphFingerprint: 'abc',
  });

  assert.equal(assessment.outcome, 'noise_repeat');
});

test('classifyReadOutcome escalates repeated inspect_region summaries to noise_repeat', () => {
  const value = 'Region ".results" contains 8 notable nodes.';
  const history: ActionHistoryEntry[] = [
    {
      action: 'inspect_region',
      selector: '.results',
      result: 'ok',
      timestamp: 1,
      graphFingerprint: 'abc',
      value,
    },
    {
      action: 'inspect_region',
      selector: '.results',
      result: 'ok',
      timestamp: 2,
      graphFingerprint: 'abc',
      value,
    },
  ];

  const assessment = classifyReadOutcome({
    action: makeAction('inspect_region', '.results'),
    value,
    goal: 'Get the first laptop price',
    history,
    graphFingerprint: 'abc',
  });

  assert.equal(assessment.sameValueCount, 3);
  assert.equal(assessment.outcome, 'noise_repeat');
});

test('classifyReadOutcome marks currency evidence as answer evidence for price goals', () => {
  const assessment = classifyReadOutcome({
    action: makeAction('find_elements', 'span.price'),
    value: 'Found 4 elements matching "span.price". Showing 4.\n1. <span> text="INR 129,999" children=0',
    goal: 'What is the price of the first laptop?',
    history: [],
    graphFingerprint: 'abc',
  });

  assert.equal(assessment.outcome, 'answer_evidence');
});

test('extractAnswerCandidate returns compact price candidate from noisy text', () => {
  const candidate = extractAnswerCandidate(
    'Get the price of the first laptop product in the search results',
    'Found 14 elements matching "span[class=\\"a-price\\"]". Showing 8. 1. <span> text="INR 130,787.07INR130,787.07" children=2',
  );

  assert.equal(candidate, 'INR 130,787.07');
});

test('extractAnswerCandidate can find price tokens beyond compact-history truncation', () => {
  const longPrefix = 'Lenovo laptop spec '.repeat(40);
  const candidate = extractAnswerCandidate(
    'Get the price of the first laptop product in the search results',
    `${longPrefix} special offer now at INR 59,999 with bundled warranty`,
  );

  assert.equal(candidate, 'INR 59,999');
});
