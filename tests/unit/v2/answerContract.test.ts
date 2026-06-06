import assert from 'node:assert/strict';
import test from 'node:test';
import { inferAnswerContract, validateAnswerAgainstContract } from '../../../src/v2/agent/AnswerContract';

test('inferAnswerContract requires non-url text for named entity goals', () => {
  const contract = inferAnswerContract('Find the latest paper about quantum computing on arXiv');
  assert.equal(contract.kind, 'ranked_entity');
  assert.equal(contract.requiresNonUrlText, true);
});

test('validateAnswerAgainstContract rejects url-only answer for entity goal', () => {
  const contract = inferAnswerContract('Find the repository with the most stars');
  const validation = validateAnswerAgainstContract('https://github.com/example/repo', contract);
  assert.equal(validation.ok, false);
  assert.deepEqual(validation.reasons, ['url_only_answer_for_named_entity_goal']);
});

test('validateAnswerAgainstContract allows numeric direct answers', () => {
  const contract = inferAnswerContract('Compute 4.2 + 7');
  const validation = validateAnswerAgainstContract('11.2', contract);
  assert.equal(validation.ok, true);
});

test('inferAnswerContract identifies url goals', () => {
  const contract = inferAnswerContract('Give me the link to the homepage');
  assert.equal(contract.kind, 'url');
  assert.equal(contract.requiresNonUrlText, false);
});

test('inferAnswerContract identifies entity goals', () => {
  const contract = inferAnswerContract('Find a repository related to machine learning');
  assert.equal(contract.kind, 'entity');
  assert.equal(contract.requiresNonUrlText, true);
});

test('inferAnswerContract returns unknown for generic goals', () => {
  const contract = inferAnswerContract('Do something interesting');
  assert.equal(contract.kind, 'unknown');
  assert.equal(contract.requiresNonUrlText, false);
});

test('validateAnswerAgainstContract rejects empty answer', () => {
  const contract = inferAnswerContract('Find something');
  const validation = validateAnswerAgainstContract('', contract);
  assert.equal(validation.ok, false);
  assert.ok(validation.reasons.includes('empty_answer'));
});

test('validateAnswerAgainstContract rejects non-numeric answer for numeric goal', () => {
  const contract = inferAnswerContract('How many reviews does the recipe have');
  const validation = validateAnswerAgainstContract('a lot of reviews', contract);
  assert.equal(validation.ok, false);
  assert.ok(validation.reasons.includes('numeric_goal_without_number'));
});
