import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTaskEvidenceCoverage, type TaskEvidenceRead } from '../../../src/v2/agent/TaskEvidenceCoverage';
import { validateAnswerAgainstContract, inferAnswerContract } from '../../../src/v2/agent/AnswerContract';

// Replicates the finalization coverage filter from src/v2/agent/V2AgentLoop.ts:865-869
function missingCoverageReasons(coverage: ReturnType<typeof buildTaskEvidenceCoverage>): string[] {
  return coverage.requirements
    .filter(requirement => requirement.status === 'missing' || requirement.status === 'conflicting')
    .map(requirement => `missing_evidence_${requirement.key}`);
}

test('TaskEvidenceCoverage: empty readEvidence produces "uncertain" state for required details', () => {
  const goal = 'Find the Cambridge definition and pronunciation for serendipity';
  const readEvidence: TaskEvidenceRead[] = [];

  const coverage = buildTaskEvidenceCoverage(goal, readEvidence);

  assert.equal(coverage.contractKind, 'description');
  assert.equal(coverage.status, 'uncertain');
  assert.equal(coverage.readCount, 0);
  assert.equal(coverage.requirements.length, 2);

  const pronunciationReq = coverage.requirements.find(r => r.key === 'pronunciation');
  assert.ok(pronunciationReq);
  assert.equal(pronunciationReq.status, 'uncertain');
  assert.deepEqual(pronunciationReq.supportingReadIndexes, []);

  const definitionReq = coverage.requirements.find(r => r.key === 'definition');
  assert.ok(definitionReq);
  assert.equal(definitionReq.status, 'uncertain');
  assert.deepEqual(definitionReq.supportingReadIndexes, []);
});

test('TaskEvidenceCoverage: temporal latest lookup does not require ranking evidence', () => {
  const goal = 'Find the latest preprints about quantum computing on arXiv';
  const readEvidence: TaskEvidenceRead[] = [];

  const coverage = buildTaskEvidenceCoverage(goal, readEvidence);

  assert.equal(coverage.contractKind, 'entity');
  assert.equal(coverage.status, 'ready');
  assert.equal(coverage.readCount, 0);
  assert.deepEqual(coverage.requirements, []);
});

test('TaskEvidenceCoverage: matching read transitions requirement to "proven" and coverage to "ready"', () => {
  const goal = 'Find the Cambridge definition and pronunciation for serendipity';
  const readEvidence: TaskEvidenceRead[] = [
    {
      kind: 'get',
      targetRef: 'v2ref_1',
      text: 'UK /ˌser.ənˈdɪp.ə.ti/ US /ˌser.ənˈdɪp.ə.t̬i/',
    },
    {
      kind: 'get',
      targetRef: 'v2ref_4',
      text: 'serendipity definition: the act of finding interesting or valuable things by chance',
    },
  ];

  const coverage = buildTaskEvidenceCoverage(goal, readEvidence);

  assert.equal(coverage.status, 'ready');
  assert.equal(coverage.readCount, 2);

  const pronunciationReq = coverage.requirements.find(r => r.key === 'pronunciation');
  assert.ok(pronunciationReq);
  assert.equal(pronunciationReq.status, 'proven');
  assert.deepEqual(pronunciationReq.supportingReadIndexes, [0]);

  const definitionReq = coverage.requirements.find(r => r.key === 'definition');
  assert.ok(definitionReq);
  assert.equal(definitionReq.status, 'proven');
  assert.deepEqual(definitionReq.supportingReadIndexes, [1]);
});

test('TaskEvidenceCoverage: unfulfilled reads transition requirement to "missing" and coverage to "incomplete"', () => {
  const goal = 'Find the Cambridge definition and pronunciation for serendipity';
  const readEvidence: TaskEvidenceRead[] = [
    {
      kind: 'get',
      targetRef: 'v2ref_10',
      text: 'Cambridge Dictionary home page navigation and footer links',
    },
  ];

  const coverage = buildTaskEvidenceCoverage(goal, readEvidence);

  assert.equal(coverage.status, 'incomplete');
  assert.equal(coverage.readCount, 1);

  const pronunciationReq = coverage.requirements.find(r => r.key === 'pronunciation');
  assert.ok(pronunciationReq);
  assert.equal(pronunciationReq.status, 'missing');

  const definitionReq = coverage.requirements.find(r => r.key === 'definition');
  assert.ok(definitionReq);
  assert.equal(definitionReq.status, 'missing');
});

test('TaskEvidenceCoverage: explicit contradictory keywords produce "conflicting" status', () => {
  const goal = 'Find the Cambridge pronunciation for serendipity';
  const readEvidence: TaskEvidenceRead[] = [
    {
      kind: 'get',
      targetRef: 'v2ref_1',
      text: 'UK /ˌser.ənˈdɪp.ə.ti/ contradictory pronunciation found on another source',
    },
  ];

  const coverage = buildTaskEvidenceCoverage(goal, readEvidence);

  assert.equal(coverage.status, 'incomplete');
  const pronunciationReq = coverage.requirements.find(r => r.key === 'pronunciation');
  assert.ok(pronunciationReq);
  assert.equal(pronunciationReq.status, 'conflicting');
});

test('TaskEvidenceCoverage: ranking evidence transitions to "proven" when sort and dimension signals exist', () => {
  const goal = 'Find the top rated hotels in Paris';
  const readEvidence: TaskEvidenceRead[] = [
    {
      kind: 'get',
      targetRef: 'v2ref_20',
      text: 'Results sorted by highest stars rating: 1. Hotel Le Bristol 5 stars',
    },
  ];

  const coverage = buildTaskEvidenceCoverage(goal, readEvidence);

  assert.equal(coverage.contractKind, 'ranked_entity');
  assert.equal(coverage.status, 'ready');

  const rankingReq = coverage.requirements.find(r => r.key === 'ranking_evidence');
  assert.ok(rankingReq);
  assert.equal(rankingReq.status, 'proven');
  assert.deepEqual(rankingReq.supportingReadIndexes, [0]);
});

test('TaskEvidenceCoverage: ranking evidence remains "uncertain" when explicit reads do NOT match sort/dimension criteria', () => {
  const goal = 'Find the top rated hotels in Paris';
  // Read exists, but only contains general header text without sorting/dimension signals
  const readEvidence: TaskEvidenceRead[] = [
    {
      kind: 'get',
      targetRef: 'v2ref_1',
      text: 'Welcome to Paris hotels booking portal and city directory',
    },
  ];

  const coverage = buildTaskEvidenceCoverage(goal, readEvidence);

  assert.equal(coverage.contractKind, 'ranked_entity');
  assert.equal(coverage.readCount, 1);

  // In accordance with TaskEvidenceCoverage.ts:73-79, ranking evidence stays uncertain (never missing)
  const rankingReq = coverage.requirements.find(r => r.key === 'ranking_evidence');
  assert.ok(rankingReq);
  assert.equal(rankingReq.status, 'uncertain');
  assert.deepEqual(rankingReq.supportingReadIndexes, []);
  assert.equal(coverage.status, 'uncertain');
});

test('TaskEvidenceCoverage: concrete basic information exact boundary step function (0, 1, 2, 3 signals)', () => {
  const goal = 'Find the basic information for Castle Mountains National Monument';

  // 0 signals -> missing
  const zeroEvidence: TaskEvidenceRead[] = [
    { kind: 'get', targetRef: 'v2ref_1', text: 'Official government natural landmark page' },
  ];
  const zeroCoverage = buildTaskEvidenceCoverage(goal, zeroEvidence);
  assert.equal(zeroCoverage.requirements[0].status, 'missing');
  assert.equal(zeroCoverage.status, 'incomplete');

  // 1 signal only (address) -> missing
  const oneSignalEvidence: TaskEvidenceRead[] = [
    { kind: 'get', targetRef: 'v2ref_1', text: 'Located in Barstow, CA 92311, USA' },
  ];
  const oneCoverage = buildTaskEvidenceCoverage(goal, oneSignalEvidence);
  assert.equal(oneCoverage.requirements[0].status, 'missing');
  assert.equal(oneCoverage.status, 'incomplete');

  // Exactly 2 signals (address + hours) -> proven (Exact boundary)
  const twoSignalsEvidence: TaskEvidenceRead[] = [
    { kind: 'get', targetRef: 'v2ref_1', text: 'Located in Barstow, CA 92311, USA. Open 24 hours daily.' },
  ];
  const twoCoverage = buildTaskEvidenceCoverage(goal, twoSignalsEvidence);
  assert.equal(twoCoverage.requirements[0].status, 'proven');
  assert.equal(twoCoverage.status, 'ready');

  // 3 signals (address + hours + phone) -> proven
  const threeSignalsEvidence: TaskEvidenceRead[] = [
    { kind: 'get', targetRef: 'v2ref_1', text: 'Located in Barstow, CA 92311, USA. Open 24 hours daily. Phone: (760) 252-6100' },
  ];
  const threeCoverage = buildTaskEvidenceCoverage(goal, threeSignalsEvidence);
  assert.equal(threeCoverage.requirements[0].status, 'proven');
  assert.equal(threeCoverage.status, 'ready');
});

test('TaskEvidenceCoverage: end-to-end finalization gate permits "proven" and "uncertain" but rejects "missing"', () => {
  const goal = 'Find the Cambridge definition and pronunciation for serendipity';
  const contract = inferAnswerContract(goal);
  const answer = 'Serendipity is pronounced UK /ˌser.ənˈdɪp.ə.ti/. It means the occurrence of events by chance.';

  // Case A: Proven coverage -> Passes finalization
  const provenReads: TaskEvidenceRead[] = [
    { kind: 'get', text: 'UK /ˌser.ənˈdɪp.ə.ti/' },
    { kind: 'get', text: 'serendipity definition: the occurrence of events by chance' },
  ];
  const provenCoverage = buildTaskEvidenceCoverage(goal, provenReads);
  const provenAnswerValidation = validateAnswerAgainstContract(answer, contract, {
    evidenceText: provenReads.map(r => r.text).join('\n'),
  });
  const provenFinalReasons = [
    ...provenAnswerValidation.reasons,
    ...(provenAnswerValidation.ok ? missingCoverageReasons(provenCoverage) : []),
  ];
  assert.equal(provenAnswerValidation.ok, true);
  assert.deepEqual(provenFinalReasons, [], 'Proven evidence must pass finalization cleanly');

  // Case B: Uncertain coverage (Direct observation without explicit reads) -> Passes finalization
  const emptyReads: TaskEvidenceRead[] = [];
  const uncertainCoverage = buildTaskEvidenceCoverage(goal, emptyReads);
  const uncertainAnswerValidation = validateAnswerAgainstContract(answer, contract, {
    evidenceText: '',
  });
  const uncertainFinalReasons = [
    ...uncertainAnswerValidation.reasons,
    ...(uncertainAnswerValidation.ok ? missingCoverageReasons(uncertainCoverage) : []),
  ];
  assert.equal(uncertainAnswerValidation.ok, true);
  assert.deepEqual(uncertainFinalReasons, [], 'Uncertain direct observation must pass finalization when answer text is valid');

  // Case C: Missing coverage (Explicit reads executed but missing required details) -> Rejected by finalization
  const missingReads: TaskEvidenceRead[] = [
    { kind: 'get', text: 'Dictionary navigation menu and search bar' },
  ];
  const missingCoverage = buildTaskEvidenceCoverage(goal, missingReads);
  const missingAnswerValidation = validateAnswerAgainstContract(answer, contract, {
    evidenceText: missingReads.map(r => r.text).join('\n'),
  });
  const missingFinalReasons = [
    ...missingAnswerValidation.reasons,
    ...(missingAnswerValidation.ok ? missingCoverageReasons(missingCoverage) : []),
  ];
  assert.ok(missingFinalReasons.includes('missing_evidence_pronunciation'), 'Missing pronunciation must be flagged');
  assert.ok(missingFinalReasons.includes('missing_evidence_definition'), 'Missing definition must be flagged');
});

test('TaskEvidenceCoverage: surface observation facts transition requirements to "proven" with sourceKind: "surface_observation"', () => {
  const goal = 'Find the Cambridge definition and pronunciation for serendipity';
  const toolReads: TaskEvidenceRead[] = [];
  const surfaceReads: TaskEvidenceRead[] = [
    {
      kind: 'surface_observation',
      sourceKind: 'surface_observation',
      observationId: 'obs_1_2',
      targetRef: 'v2ref_1',
      refIds: ['v2ref_1'],
      text: 'UK /ˌser.ənˈdɪp.ə.ti/ US /ˌser.ənˈdɪp.ə.t̬i/',
    },
    {
      kind: 'surface_observation',
      sourceKind: 'surface_observation',
      observationId: 'obs_1_2',
      targetRef: 'v2ref_4',
      refIds: ['v2ref_4'],
      text: 'serendipity definition: the occurrence of events by chance',
    },
  ];

  const coverage = buildTaskEvidenceCoverage(goal, toolReads, surfaceReads);

  assert.equal(coverage.status, 'ready');
  assert.equal(coverage.readCount, 2);

  const pronunciationReq = coverage.requirements.find(r => r.key === 'pronunciation');
  assert.ok(pronunciationReq);
  assert.equal(pronunciationReq.status, 'proven');
  assert.deepEqual(pronunciationReq.supportingReadIndexes, [0]);

  const definitionReq = coverage.requirements.find(r => r.key === 'definition');
  assert.ok(definitionReq);
  assert.equal(definitionReq.status, 'proven');
  assert.deepEqual(definitionReq.supportingReadIndexes, [1]);
});

test('TaskEvidenceCoverage: multi-ref basic information aggregation proves requirement across distinct surface elements', () => {
  const goal = 'Find basic information for Castle Mountains National Monument on Google Maps';
  const toolReads: TaskEvidenceRead[] = [];
  const surfaceReads: TaskEvidenceRead[] = [
    {
      kind: 'surface_observation',
      sourceKind: 'surface_observation',
      observationId: 'obs_1_4',
      targetRef: 'v2ref_316',
      refIds: ['v2ref_316'],
      text: 'Address: Barstow, CA 92311, United States',
    },
    {
      kind: 'surface_observation',
      sourceKind: 'surface_observation',
      observationId: 'obs_1_4',
      targetRef: 'v2ref_326',
      refIds: ['v2ref_326'],
      text: 'Open 24 hours',
    },
    {
      kind: 'surface_observation',
      sourceKind: 'surface_observation',
      observationId: 'obs_1_4',
      targetRef: 'v2ref_342',
      refIds: ['v2ref_342'],
      text: 'Website: nps.gov',
    },
  ];

  const coverage = buildTaskEvidenceCoverage(goal, toolReads, surfaceReads);

  assert.equal(coverage.contractKind, 'description');
  assert.equal(coverage.status, 'ready');
  assert.equal(coverage.readCount, 3);

  const basicInfoReq = coverage.requirements.find(r => r.key === 'concrete_basic_information');
  assert.ok(basicInfoReq);
  assert.equal(basicInfoReq.status, 'proven');
  // Both Address (idx 0) and Hours (idx 1) are supporting reads
  assert.ok(basicInfoReq.supportingReadIndexes.includes(0));
  assert.ok(basicInfoReq.supportingReadIndexes.includes(1));
});

test('TaskEvidenceCoverage: control-only basic information labels are strictly rejected (0 signals matched)', () => {
  const controlOnlyBasicInfo = [
    'Hours',
    'Opening hours',
    'Business hours',
    'Store hours',
    'View hours',
    'Contact',
    'Contact us',
    'Call',
    'Send to phone',
    'Address',
    'Location',
    'Directions',
    'Get directions',
    'Reviews',
    'Ratings',
    'Customer reviews',
    'Write a review',
    'Tickets',
    'Pricing',
    'Admission',
    'Buy tickets',
  ];

  const goal = 'Find basic information for Castle Mountains National Monument on Google Maps';
  const toolReads: TaskEvidenceRead[] = [];
  const surfaceReads: TaskEvidenceRead[] = controlOnlyBasicInfo.map((text, i) => ({
    kind: 'surface_observation',
    sourceKind: 'surface_observation' as const,
    observationId: 'obs_1_1',
    targetRef: `ref_${i}`,
    refIds: [`ref_${i}`],
    text,
  }));

  const coverage = buildTaskEvidenceCoverage(goal, toolReads, surfaceReads);
  const basicInfoReq = coverage.requirements.find(r => r.key === 'concrete_basic_information');
  assert.ok(basicInfoReq);
  // Must be uncertain (0 signals matched), NOT proven!
  assert.equal(basicInfoReq.status, 'uncertain');
  assert.deepEqual(basicInfoReq.supportingReadIndexes, []);
  assert.equal(coverage.status, 'uncertain');
});

test('TaskEvidenceCoverage: value-bearing basic information items prove requirement', () => {
  const goal = 'Find basic information for Castle Mountains National Monument on Google Maps';
  const toolReads: TaskEvidenceRead[] = [];
  const surfaceReads: TaskEvidenceRead[] = [
    {
      kind: 'surface_observation',
      sourceKind: 'surface_observation' as const,
      observationId: 'obs_1_1',
      targetRef: 'ref_addr',
      refIds: ['ref_addr'],
      text: '123 Main St, Springfield, IL 62701',
    },
    {
      kind: 'surface_observation',
      sourceKind: 'surface_observation' as const,
      observationId: 'obs_1_1',
      targetRef: 'ref_hours',
      refIds: ['ref_hours'],
      text: 'Mon-Fri 9:00 AM - 5:00 PM',
    },
  ];

  const coverage = buildTaskEvidenceCoverage(goal, toolReads, surfaceReads);
  const basicInfoReq = coverage.requirements.find(r => r.key === 'concrete_basic_information');
  assert.ok(basicInfoReq);
  assert.equal(basicInfoReq.status, 'proven');
  assert.equal(coverage.status, 'ready');
});

test('TaskEvidenceCoverage: isolated identifiers, dates, and unanchored counts remain uncertain for ranking evidence', () => {
  const isolatedNegatives = [
    'arXiv:2608.24832',
    'Search v0.5.6 released 2020-02-24',
    '500 citations',
    '10 results found',
    '25 results per page',
    'Title: Quantum Error Correction Architecture',
    'Author: John Doe',
    'Sort by: Most stars',
    'Order by: Price low to high',
    'Filter by: Highest rating',
    'Sort by Relevance',
    'Order by Date',
    'Group by category',
  ];

  const goal = 'Find trending TypeScript repositories on GitHub and note top stars';
  const toolReads: TaskEvidenceRead[] = [];
  const surfaceReads: TaskEvidenceRead[] = isolatedNegatives.map((text, i) => ({
    kind: 'surface_observation',
    sourceKind: 'surface_observation' as const,
    observationId: 'obs_1_1',
    targetRef: `ref_${i}`,
    refIds: [`ref_${i}`],
    text,
  }));

  const coverage = buildTaskEvidenceCoverage(goal, toolReads, surfaceReads);
  const rankingReq = coverage.requirements.find(r => r.key === 'ranking_evidence');
  assert.ok(rankingReq);
  assert.equal(rankingReq.status, 'uncertain');
  assert.deepEqual(rankingReq.supportingReadIndexes, []);
  assert.equal(coverage.status, 'uncertain');
});

test('TaskEvidenceCoverage: value-bearing ranking evidence transitions ranking_evidence to proven', () => {
  const valueBearingRanking = [
    '#1 Best Seller in Electronics',
    'Top 10 preprints in quantum computing',
    'Rank 1: TypeScript (98.4k stars)',
    '1st result: Quantum Gate Optimization',
    'Most starred repository: microsoft/TypeScript (98.4k stars)',
    'Cheapest flight: $120 to Paris',
    'Highest rated hotel: Grand Hyatt (4.9 stars, 1,250 reviews)',
  ];

  const goal = 'Find trending TypeScript repositories on GitHub and note top stars';
  const toolReads: TaskEvidenceRead[] = [];
  const surfaceReads: TaskEvidenceRead[] = valueBearingRanking.map((text, i) => ({
    kind: 'surface_observation',
    sourceKind: 'surface_observation' as const,
    observationId: 'obs_1_1',
    targetRef: `ref_${i}`,
    refIds: [`ref_${i}`],
    text,
  }));

  const coverage = buildTaskEvidenceCoverage(goal, toolReads, surfaceReads);
  const rankingReq = coverage.requirements.find(r => r.key === 'ranking_evidence');
  assert.ok(rankingReq);
  assert.equal(rankingReq.status, 'proven');
  assert.ok(rankingReq.supportingReadIndexes.length > 0);
  assert.equal(coverage.status, 'ready');
});
