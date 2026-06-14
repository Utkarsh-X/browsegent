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

test('inferAnswerContract records required details for multi-detail lookup goals', () => {
  const contract = inferAnswerContract('Look up the pronunciation and definition of the word "sustainability"');
  assert.deepEqual(contract.requiredDetails, ['pronunciation', 'definition']);
});

test('inferAnswerContract records concrete detail requirement for basic information goals', () => {
  const contract = inferAnswerContract('Find out its Basic Information');
  assert.deepEqual(contract.requiredDetails, ['concrete_basic_information']);
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

test('validateAnswerAgainstContract rejects pronunciation placeholder without actual pronunciation', () => {
  const contract = inferAnswerContract('Look up the pronunciation and definition of the word "sustainability"');
  const validation = validateAnswerAgainstContract(
    'Sustainability means the quality of being able to continue over time. Pronunciation is available using the UK and US audio buttons.',
    contract,
  );

  assert.equal(validation.ok, false);
  assert.ok(validation.reasons.includes('missing_pronunciation_detail'));
});

test('validateAnswerAgainstContract accepts concrete pronunciation and definition details', () => {
  const contract = inferAnswerContract('Look up the pronunciation and definition of the word "sustainability"');
  const validation = validateAnswerAgainstContract(
    'UK: /səˌsteɪ.nəˈbɪl.ə.ti/, US: /səˌsteɪ.nəˈbɪl.ə.t̬i/; definition: the quality of being able to continue over a period of time.',
    contract,
  );

  assert.equal(validation.ok, true);
});

test('validateAnswerAgainstContract requires concrete fields for basic information goals', () => {
  const contract = inferAnswerContract('Find out its Basic Information');
  const validation = validateAnswerAgainstContract('It is a beautiful national monument with desert grassland.', contract);

  assert.equal(validation.ok, false);
  assert.ok(validation.reasons.includes('missing_concrete_basic_information'));
});

test('validateAnswerAgainstContract rejects one pronunciation variant when evidence contains UK and US variants', () => {
  const contract = inferAnswerContract('Look up the pronunciation and definition of the word "sustainability"');
  const validation = validateAnswerAgainstContract(
    'The pronunciation is /sÉ™ËŒsteÉª.nÉ™ËˆbÉªl.É™.ti/ (UK). The definition is the quality of being able to continue over a period of time.',
    contract,
    {
      evidenceText:
        'sustainability noun [ U ] uk Your browser does not support HTML5 audio /sÉ™ËŒsteÉª.nÉ™ËˆbÉªl.É™.ti/ us Your browser does not support HTML5 audio /sÉ™ËŒsteÉª.nÉ™ËˆbÉªl.É™.tÌ¬i/ the quality of being able to continue over a period of time',
    },
  );

  assert.equal(validation.ok, false);
  assert.ok(validation.reasons.includes('missing_pronunciation_variant_us'));
});
