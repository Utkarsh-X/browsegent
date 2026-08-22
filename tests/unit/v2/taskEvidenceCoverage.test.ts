import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTaskEvidenceCoverage } from '../../../src/v2/agent/TaskEvidenceCoverage';

test('coverage marks pronunciation and definition as proven by one explicit read', () => {
  const coverage = buildTaskEvidenceCoverage(
    'Give the pronunciation and definition of sustainability',
    [{
      kind: 'get',
      targetRef: 'ref_result',
      text: 'Definition: the ability to continue. UK pronunciation /səˌsteɪ.nəˈbɪl.ə.ti/. US pronunciation /səˌsteɪ.nəˈbɪl.ə.t̬i/.',
    }],
  );

  assert.equal(coverage.status, 'ready');
  assert.deepEqual(
    coverage.requirements.map(requirement => [requirement.key, requirement.status, requirement.supportingReadIndexes]),
    [
      ['pronunciation', 'proven', [0]],
      ['definition', 'proven', [0]],
    ],
  );
});

test('coverage reports missing concrete information when a read is only descriptive', () => {
  const coverage = buildTaskEvidenceCoverage(
    'Find basic information about Castle Mountains National Monument',
    [{ kind: 'get', targetRef: 'ref_result', text: 'Castle Mountains National Monument is a protected desert landscape.' }],
  );

  assert.equal(coverage.status, 'incomplete');
  assert.equal(coverage.requirements[0]?.key, 'concrete_basic_information');
  assert.equal(coverage.requirements[0]?.status, 'missing');
});

test('coverage keeps ranking evidence uncertain without explicit ordering proof', () => {
  const coverage = buildTaskEvidenceCoverage(
    'Find the most starred climate change repository',
    [{ kind: 'get', targetRef: 'ref_repo', text: 'Repository: climate-tools. Stars: 40.' }],
  );

  assert.equal(coverage.status, 'uncertain');
  assert.equal(coverage.requirements[0]?.key, 'ranking_evidence');
  assert.equal(coverage.requirements[0]?.status, 'uncertain');
});

test('coverage reports explicit contradictory evidence without copying read text', () => {
  const coverage = buildTaskEvidenceCoverage(
    'Give the definition',
    [
      { kind: 'get', targetRef: 'ref_old', text: 'Definition: the ability to continue.' },
      { kind: 'get', targetRef: 'ref_new', text: 'The sources are inconsistent: the definition differs.' },
    ],
  );

  assert.equal(coverage.requirements[0]?.key, 'definition');
  assert.equal(coverage.requirements[0]?.status, 'conflicting');
  assert.equal(coverage.status, 'incomplete');
  assert.equal(JSON.stringify(coverage).includes('ability to continue'), false);
  assert.equal(JSON.stringify(coverage).includes('definition differs'), false);
});

test('coverage preserves current behavior for an unknown goal', () => {
  const coverage = buildTaskEvidenceCoverage('Do the requested task', []);

  assert.equal(coverage.status, 'ready');
  assert.deepEqual(coverage.requirements, []);
});
