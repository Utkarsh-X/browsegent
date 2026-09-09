import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { retractsGroundedValues } from '../../../src/v2/agent/V2AgentLoop';

/**
 * Answer-quality round 3 (D1 retract-guard, world-model round-3 report §11.2.1):
 * the done-candidate checklist must never swap a grounded answer for a
 * confident-sounding give-up. The measured failure (run 27): the original
 * "approximately 0.505 gauss" was replaced by "not explicitly provided…", and
 * the judge pass was lost. The guard is structural: numeric measurements in
 * the original must survive into any accepted revision.
 */
describe('D1 retract-guard (done-candidate revision)', () => {
  it('rejects the Wolfram shape: numeric answer replaced by a give-up', () => {
    const original = 'The magnetic field strength is approximately 0.505 gauss.';
    const giveUp = 'The magnetic field strength is not explicitly provided on the page; it displays the magnetic declination instead.';
    assert.equal(retractsGroundedValues(original, giveUp), true);
  });

  it('rejects give-ups that drop some but not all grounded numbers', () => {
    const original = 'The Pro plan costs $15 per month ($180 per year).';
    const partial = 'The Pro plan costs $15 per month. Yearly billing is not shown.';
    assert.equal(retractsGroundedValues(original, partial), true);
  });

  it('accepts a rewording that keeps the values', () => {
    const original = 'The magnetic field strength is approximately 0.505 gauss.';
    const reworded = 'Approximately 0.505 gauss is the measured magnetic field strength.';
    assert.equal(retractsGroundedValues(original, reworded), false);
  });

  it('accepts a revision that adds precision (keeps original numbers)', () => {
    const original = 'The Pro plan costs $15 per month ($180 per year).';
    const enriched = 'The Pro plan costs $15 per month ($180 per year), billed annually.';
    assert.equal(retractsGroundedValues(original, enriched), false);
  });

  it('accepts revisions when the original grounds no numbers', () => {
    assert.equal(retractsGroundedValues('The capital is Paris.', 'The capital of France is Paris.'), false);
  });

  it('accepts replacing a spelled number with digits and vice versa only when values survive', () => {
    // "5" absent from revision because it now says "five" — the guard is
    // deliberately structural (digits must survive); the contract validators
    // still assess overall validity. This documents the conservative behavior:
    assert.equal(retractsGroundedValues('List 5 salons with ratings above 4.8', 'Found five salons with ratings above 4.8'), true);
  });

  it('treats integers and decimals symmetrically', () => {
    const original = 'The distance is 3.5 km and costs 42 rupees.';
    assert.equal(retractsGroundedValues(original, 'Distance: 3.5 km. Cost not listed.'), true);
    assert.equal(retractsGroundedValues(original, 'It is 3.5 km away and costs 42 rupees total.'), false);
  });
});
