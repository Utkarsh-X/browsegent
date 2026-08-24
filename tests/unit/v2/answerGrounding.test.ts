import assert from 'node:assert/strict';
import test from 'node:test';
import { detectAnswerEvidenceConflicts } from '../../../src/v2/agent/AnswerGrounding';

const COPILOT_READS = [
  'GitHub Copilot Individual is priced at $10 USD per month or $100 USD per year.',
  'Plans include code completions, chat, and CLI support for indie developers and freelancers.',
].join('\n');

test('flags a money claim that contradicts a same-unit value present in read evidence', () => {
  const result = detectAnswerEvidenceConflicts(
    'GitHub Copilot Individual costs $10 per month, which totals $120 per year.',
    COPILOT_READS,
  );
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].claim, '$120');
  assert.equal(result.conflicts[0].evidenceValue, '$100');
});

test('does not flag a money claim whose value is present in the read evidence', () => {
  const result = detectAnswerEvidenceConflicts(
    'GitHub Copilot Individual costs $10 per month or $100 per year.',
    COPILOT_READS,
  );
  assert.deepEqual(result.conflicts, []);
});

test('allows arithmetic over a single source value when the derived value is absent', () => {
  const monthlyOnlyReads = 'GitHub Copilot Individual is priced at $10 USD per month.';
  const result = detectAnswerEvidenceConflicts(
    'At $10 per month the yearly cost is $120.',
    monthlyOnlyReads,
  );
  assert.deepEqual(result.conflicts, []);
});

test('flags a percent claim that contradicts a same-context value in the read evidence', () => {
  const result = detectAnswerEvidenceConflicts(
    'The seller has a 95% positive rating.',
    'Seller feedback: 93% positive rating in the last 12 months.',
  );
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].claim, '95%');
  assert.equal(result.conflicts[0].evidenceValue, '93%');
});

test('does not cross-match values from different unit contexts', () => {
  const result = detectAnswerEvidenceConflicts(
    'The plan costs $120 per year.',
    'The monthly add-on is $15 per month.',
  );
  assert.deepEqual(result.conflicts, []);
});

test('normalizes thousands separators when comparing claims to evidence', () => {
  const result = detectAnswerEvidenceConflicts(
    'The cheapest option is $1,200 per year.',
    'Annual subscription listed at $1,199 per year. A competitor charges $1,200 per year.',
  );
  // The claimed value exists verbatim elsewhere in the evidence, so no conflict.
  assert.deepEqual(result.conflicts, []);
});

test('returns no conflicts when evidence is missing or empty', () => {
  assert.deepEqual(detectAnswerEvidenceConflicts('It costs $120 per year.', undefined).conflicts, []);
  assert.deepEqual(detectAnswerEvidenceConflicts('It costs $120 per year.', '   ').conflicts, []);
});

test('ignores numbers without a currency or percent marker', () => {
  const result = detectAnswerEvidenceConflicts(
    'The plan includes 2000 completions per month.',
    'The plan includes 3000 completions per month.',
  );
  assert.deepEqual(result.conflicts, []);
});

test('reports each conflicting claim independently', () => {
  const result = detectAnswerEvidenceConflicts(
    'It costs $120 per year with a 90% renewal discount.',
    'Pricing is $100 per year with an 80% renewal discount.',
  );
  assert.equal(result.conflicts.length, 2);
});
