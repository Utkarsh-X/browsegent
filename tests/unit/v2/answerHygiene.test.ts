import test from 'node:test';
import assert from 'node:assert/strict';

import { hasInternalRefTokens, stripInternalRefTokens } from '../../../src/v2/agent/AnswerHygiene';

test('hasInternalRefTokens detects parenthesized and bare internal refs', () => {
  assert.equal(hasInternalRefTokens("available as 'green controller' (v2ref_1216) or '4 stars' (v2ref_1237)"), true);
  assert.equal(hasInternalRefTokens('listed at v2ref_42 on the page'), true);
  assert.equal(hasInternalRefTokens('The controller is available in Velocity Green.'), false);
  assert.equal(hasInternalRefTokens(''), false);
});

test('stripInternalRefTokens removes parenthesized refs and tidies spacing', () => {
  assert.equal(
    stripInternalRefTokens("available as 'green controller' (v2ref_1216) or '4 stars' (v2ref_1237)."),
    "available as 'green controller' or '4 stars'.",
  );
});

test('stripInternalRefTokens removes bare refs', () => {
  assert.equal(
    stripInternalRefTokens('The rating shown at v2ref_42 is 4.6 stars.'),
    'The rating shown at is 4.6 stars.',
  );
});

test('stripInternalRefTokens is byte-identical for leak-free values', () => {
  const value = 'Line one.\n\nLine two   keeps internal spacing.';
  assert.equal(stripInternalRefTokens(value), value);
  assert.equal(stripInternalRefTokens(''), '');
});

test('stripInternalRefTokens preserves multi-line formatting when a leak is removed', () => {
  const value = 'Price: $10/month (v2ref_7)\nNotes:   billed yearly';
  assert.equal(stripInternalRefTokens(value), 'Price: $10/month\nNotes: billed yearly');
});

test('stripInternalRefTokens handles ref-adjacent punctuation artifacts', () => {
  assert.equal(
    stripInternalRefTokens('Options: (v2ref_1), (v2ref_2)'),
    'Options:',
  );
});
