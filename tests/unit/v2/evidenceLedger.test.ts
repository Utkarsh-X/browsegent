import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractActiveSort,
  extractResultCards,
  EvidenceLedger,
} from '../../../src/v2/agent/EvidenceLedger';
import type { BrowserObservation, V2Ref } from '../../../src/v2/runtime/types';

function makeRef(props: Partial<V2Ref> & { refId: string }): V2Ref {
  return {
    generationId: 1,
    targetId: props.refId,
    selectorCandidates: [`#${props.refId}`],
    visibility: 'visible',
    actionability: 'ready',
    continuityConfidence: 1,
    state: 'live',
    ...props,
  };
}

function makeObservation(id: string, url: string, refs: V2Ref[]): BrowserObservation {
  return {
    observationId: id,
    sessionId: 'session_test',
    generationId: 1,
    url,
    title: 'Test Page',
    timestamp: Date.now(),
    refs,
    warnings: [],
    stats: {
      refCount: refs.length,
      visibleRefCount: refs.filter(r => r.visibility === 'visible').length,
      durationMs: 10,
    },
  };
}

test('extractActiveSort extracts sort from GitHub and arXiv URL queries', () => {
  const githubSort = extractActiveSort('https://github.com/search?q=climate&type=repositories&s=stars&o=desc');
  assert.ok(githubSort);
  assert.equal(githubSort.dimension, 'stars');
  assert.equal(githubSort.direction, 'desc');
  assert.equal(githubSort.source, 'url_query');

  const arxivSort = extractActiveSort('https://arxiv.org/search/?query=quantum&order=-announced_date_first');
  assert.ok(arxivSort);
  assert.equal(arxivSort.dimension, 'date');
  assert.equal(arxivSort.direction, 'desc');

  const priceSort = extractActiveSort('https://booking.com/search?sort=price_asc');
  assert.ok(priceSort);
  assert.equal(priceSort.dimension, 'price');
  assert.equal(priceSort.direction, 'asc');
});

test('extractActiveSort extracts sort from active DOM controls', () => {
  const refs = [
    makeRef({
      refId: 'ref_sort',
      role: 'button',
      name: 'Sort by: Most stars',
      text: 'Sort by: Most stars',
    }),
  ];
  const domSort = extractActiveSort('https://github.com/search?q=climate', refs);
  assert.ok(domSort);
  assert.equal(domSort.dimension, 'stars');
  assert.equal(domSort.direction, 'desc');
  assert.equal(domSort.source, 'active_control');
});

test('extractResultCards groups split-node items using spatial layout bands', () => {
  const refs: V2Ref[] = [
    makeRef({
      refId: 'ref_repo_1',
      role: 'link',
      name: 'resource-watch/resource-watch',
      text: 'resource-watch/resource-watch',
      box: { x: 368, y: 85, width: 229, height: 24 },
    }),
    makeRef({
      refId: 'ref_stars_1',
      role: 'link',
      name: '73 stars',
      text: '73',
      box: { x: 427, y: 194.5, width: 35, height: 18 },
    }),
    makeRef({
      refId: 'ref_repo_2',
      role: 'link',
      name: 'Beckybams/Climate-Tools',
      text: 'Beckybams/Climate-Tools',
      box: { x: 368, y: 264, width: 372, height: 24 },
    }),
    makeRef({
      refId: 'ref_stars_2',
      role: 'link',
      name: '40 stars',
      text: '40',
      box: { x: 338, y: 339.5, width: 35, height: 18 },
    }),
  ];

  const obs = makeObservation('obs_github', 'https://github.com/search?s=stars&o=desc', refs);
  const activeSort = extractActiveSort(obs.url, refs);
  const cards = extractResultCards(obs, activeSort);

  assert.equal(cards.length, 2);

  // Card 1
  assert.equal(cards[0].positionIndex, 0);
  assert.equal(cards[0].entityName, 'resource-watch/resource-watch');
  assert.equal(cards[0].metrics.stars, 73);
  assert.equal(cards[0].provenRank, 1); // Proven rank 1 because sort is active
  assert.deepEqual(cards[0].refIds, ['ref_repo_1', 'ref_stars_1']);

  // Card 2
  assert.equal(cards[1].positionIndex, 1);
  assert.equal(cards[1].entityName, 'Beckybams/Climate-Tools');
  assert.equal(cards[1].metrics.stars, 40);
  assert.equal(cards[1].provenRank, 2);
  assert.deepEqual(cards[1].refIds, ['ref_repo_2', 'ref_stars_2']);
});

test('extractResultCards does not promote unrelated page links into ranked cards', () => {
  const refs: V2Ref[] = [
    makeRef({
      refId: 'ref_result_count',
      role: 'link',
      name: '(1.3k)',
      text: '(1.3k)',
      selectorCandidates: ['a[href="/search?q=climate&type=repositories"]'],
      box: { x: 16, y: 70, width: 45, height: 20 },
    }),
    makeRef({
      refId: 'ref_repo_1',
      role: 'link',
      name: 'owner/repo-one',
      text: 'owner/repo-one',
      selectorCandidates: ['a[href="/owner/repo-one"]'],
      box: { x: 368, y: 150, width: 229, height: 24 },
    }),
    makeRef({
      refId: 'ref_stars_1',
      role: 'link',
      name: '73 stars',
      text: '73',
      selectorCandidates: ['a[href="/owner/repo-one/stargazers"]'],
      box: { x: 427, y: 258, width: 35, height: 18 },
    }),
    makeRef({
      refId: 'ref_repo_2',
      role: 'link',
      name: 'owner/repo-two',
      text: 'owner/repo-two',
      selectorCandidates: ['a[href="/owner/repo-two"]'],
      box: { x: 368, y: 328, width: 229, height: 24 },
    }),
    makeRef({
      refId: 'ref_stars_2',
      role: 'link',
      name: '40 stars',
      text: '40',
      selectorCandidates: ['a[href="/owner/repo-two/stargazers"]'],
      box: { x: 338, y: 403, width: 35, height: 18 },
    }),
  ];

  const obs = makeObservation(
    'obs_github_unrelated_links',
    'https://github.com/search?q=climate&type=repositories&s=stars&o=desc',
    refs,
  );
  const activeSort = extractActiveSort(obs.url, refs);
  const cards = extractResultCards(obs, activeSort);

  assert.deepEqual(cards.map(card => card.entityName), ['owner/repo-one', 'owner/repo-two']);
  assert.deepEqual(cards.map(card => card.provenRank), [1, 2]);
  assert.ok(cards.every(card => !card.refIds.includes('ref_result_count')));
});

test('extractResultCards supports fallback grouping when bounding boxes are missing', () => {
  const refs: V2Ref[] = [
    makeRef({
      refId: 'ref_arxiv_1',
      role: 'link',
      name: 'arXiv:2608.27457',
      text: 'arXiv:2608.27457',
    }),
    makeRef({
      refId: 'ref_date_1',
      role: 'text',
      name: 'Submitted 24 August 2026',
      text: 'Submitted 24 August 2026',
    }),
    makeRef({
      refId: 'ref_arxiv_2',
      role: 'link',
      name: 'arXiv:2608.27444',
      text: 'arXiv:2608.27444',
    }),
    makeRef({
      refId: 'ref_date_2',
      role: 'text',
      name: 'Submitted 23 August 2026',
      text: 'Submitted 23 August 2026',
    }),
  ];

  const obs = makeObservation('obs_arxiv', 'https://arxiv.org/search/?order=-announced_date_first', refs);
  const activeSort = extractActiveSort(obs.url, refs);
  const cards = extractResultCards(obs, activeSort);

  assert.equal(cards.length, 2);
  assert.equal(cards[0].entityName, 'arXiv:2608.27457');
  assert.equal(cards[0].provenRank, 1);
  assert.equal(cards[1].entityName, 'arXiv:2608.27444');
  assert.equal(cards[1].provenRank, 2);
});

test('extractResultCards keeps provenRank undefined when sort is default relevance', () => {
  const refs: V2Ref[] = [
    makeRef({
      refId: 'ref_repo_1',
      role: 'link',
      name: 'owner/unsorted-repo',
      text: 'owner/unsorted-repo',
      box: { x: 100, y: 100, width: 200, height: 30 },
    }),
    makeRef({
      refId: 'ref_stars_1',
      role: 'text',
      name: '15 stars',
      text: '15 stars',
      box: { x: 100, y: 140, width: 50, height: 20 },
    }),
  ];

  // No sort query in URL
  const obs = makeObservation('obs_default', 'https://github.com/search?q=test', refs);
  const activeSort = extractActiveSort(obs.url, refs);
  assert.equal(activeSort, undefined);

  const cards = extractResultCards(obs, activeSort);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].entityName, 'owner/unsorted-repo');
  assert.equal(cards[0].metrics.stars, 15);
  assert.equal(cards[0].provenRank, undefined); // Not proven to be top rank
});

test('EvidenceLedger maintains multi-step history and formats validation text', () => {
  const ledger = new EvidenceLedger();

  const refs: V2Ref[] = [
    makeRef({
      refId: 'ref_repo_1',
      role: 'link',
      name: 'resource-watch/resource-watch',
      text: 'resource-watch/resource-watch',
      box: { x: 368, y: 85, width: 229, height: 24 },
    }),
    makeRef({
      refId: 'ref_stars_1',
      role: 'link',
      name: '73 stars',
      text: '73',
      box: { x: 427, y: 194.5, width: 35, height: 18 },
    }),
  ];

  const obs = makeObservation('obs_1', 'https://github.com/search?s=stars&o=desc', refs);
  ledger.recordObservation(obs);

  // Add explicit tool read
  ledger.recordToolRead({
    kind: 'get',
    targetRef: 'ref_repo_1',
    text: 'Repository: resource-watch/resource-watch, description: Climate change data visualization',
  });

  const validationText = ledger.buildValidationEvidenceText();
  assert.ok(validationText.includes('Repository: resource-watch/resource-watch'));
  assert.ok(validationText.includes('[Active Sort: stars (desc) via url_query]'));
  assert.ok(validationText.includes('[Card 1: Rank #1 | resource-watch/resource-watch | 73 stars]'));

  const allReads = ledger.getAllEvidenceReads();
  assert.ok(allReads.length >= 2);
  assert.ok(allReads.some(r => r.text.includes('Rank #1 | resource-watch/resource-watch | 73 stars')));
});

test('EvidenceLedger exposes a bounded semantic snapshot for replanning', () => {
  const ledger = new EvidenceLedger();
  const refs: V2Ref[] = [
    makeRef({
      refId: 'ref_repo_1',
      role: 'link',
      name: 'owner/repo-one',
      text: 'owner/repo-one',
      box: { x: 100, y: 100, width: 200, height: 30 },
    }),
    makeRef({
      refId: 'ref_stars_1',
      role: 'text',
      name: '73 stars',
      text: '73 stars',
      box: { x: 100, y: 140, width: 50, height: 20 },
    }),
  ];
  ledger.recordObservation(makeObservation('obs_snapshot', 'https://example.test/search?s=stars&o=desc', refs));

  const snapshot = ledger.getPlannerEvidenceSnapshot();
  assert.ok(snapshot);
  assert.deepEqual(snapshot.activeSort, { dimension: 'stars', direction: 'desc', source: 'url_query' });
  assert.equal(snapshot.cards.length, 1);
  assert.deepEqual(snapshot.cards[0], {
    position: 0,
    entity: 'owner/repo-one',
    provenRank: 1,
    metrics: { stars: 73 },
    refIds: ['ref_repo_1', 'ref_stars_1'],
  });
});

test('EvidenceLedger anti-leak: Card 1 attributes do not leak to Card 2', () => {
  const ledger = new EvidenceLedger();
  const refs: V2Ref[] = [
    makeRef({
      refId: 'ref_repo_a',
      role: 'link',
      name: 'author/repo-a',
      text: 'author/repo-a',
      box: { x: 100, y: 100, width: 200, height: 30 },
    }),
    makeRef({
      refId: 'ref_stars_a',
      role: 'text',
      name: '10 stars',
      text: '10 stars',
      box: { x: 100, y: 140, width: 50, height: 20 },
    }),
    makeRef({
      refId: 'ref_repo_b',
      role: 'link',
      name: 'author/repo-b',
      text: 'author/repo-b',
      box: { x: 100, y: 300, width: 200, height: 30 },
    }),
    makeRef({
      refId: 'ref_stars_b',
      role: 'text',
      name: '500 stars',
      text: '500 stars',
      box: { x: 100, y: 340, width: 50, height: 20 },
    }),
  ];

  const obs = makeObservation('obs_anti_leak', 'https://github.com/search?s=stars&o=desc', refs);
  ledger.recordObservation(obs);

  const cards = ledger.getResultCards();
  assert.equal(cards.length, 2);

  // Card 1 has strictly 10 stars (NOT 500)
  assert.equal(cards[0].entityName, 'author/repo-a');
  assert.equal(cards[0].metrics.stars, 10);
  assert.notEqual(cards[0].metrics.stars, 500);

  // Card 2 has strictly 500 stars (NOT 10)
  assert.equal(cards[1].entityName, 'author/repo-b');
  assert.equal(cards[1].metrics.stars, 500);
  assert.notEqual(cards[1].metrics.stars, 10);
});

test('EvidenceLedger rejects standalone sort controls when 0 result cards exist', () => {
  const ledger = new EvidenceLedger();
  const refs: V2Ref[] = [
    makeRef({
      refId: 'ref_sort',
      role: 'button',
      name: 'Sort by: Most stars',
      text: 'Sort by: Most stars',
    }),
  ];

  const obs = makeObservation('obs_empty', 'https://github.com/search?q=nothing_found', refs);
  ledger.recordObservation(obs);

  assert.equal(ledger.getResultCards().length, 0);
  const validationText = ledger.buildValidationEvidenceText();
  assert.ok(!validationText.includes('Rank #1'));
});

test('EvidenceLedger does not infer a result list from two content headings on a normal page', () => {
  const ledger = new EvidenceLedger();
  const refs: V2Ref[] = [
    makeRef({
      refId: 'ref_story_a',
      role: 'heading',
      name: 'First editorial story',
      text: 'First editorial story',
    }),
    makeRef({
      refId: 'ref_story_b',
      role: 'heading',
      name: 'Second editorial story',
      text: 'Second editorial story',
    }),
  ];

  ledger.recordObservation(makeObservation('obs_normal_page', 'https://www.example.test/news', refs));

  assert.deepEqual(ledger.getResultCards(), []);
  assert.equal(ledger.getPlannerEvidenceSnapshot(), undefined);
});

test('EvidenceLedger: Real GitHub captured trace regression (obs_1_8.json)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const obsPath = path.resolve('logs/webvoyager-lite/webvoyager_lite_1788032835956/traces/webvoyager_lite_1788032835956_webvoyager_GitHub__0_a1/observations/obs_1_8.json');
  if (!fs.existsSync(obsPath)) return; // Skip if run log not present on disk

  const obs: BrowserObservation = JSON.parse(fs.readFileSync(obsPath, 'utf8'));
  const activeSort = extractActiveSort(obs.url, obs.refs);
  assert.ok(activeSort);
  assert.equal(activeSort.dimension, 'stars');
  assert.equal(activeSort.direction, 'desc');

  const cards = extractResultCards(obs, activeSort);
  // Must extract the 4 true repository cards, not 40 facet links
  assert.equal(cards.length, 4);

  // Card 1: resource-watch/resource-watch with 73 stars at Rank #1
  assert.equal(cards[0].entityName, 'resource-watch/resource-watch');
  assert.equal(cards[0].metrics.stars, 73);
  assert.equal(cards[0].provenRank, 1);

  // Card 2: Beckybams with 40 stars at Rank #2
  assert.equal(cards[1].entityName, 'Beckybams/AI-Enhanced-Climate-Education-Tools-');
  assert.equal(cards[1].metrics.stars, 40);
  assert.equal(cards[1].provenRank, 2);

  // Card 3: WorldWindLabs with 20 stars at Rank #3
  assert.equal(cards[2].entityName, 'WorldWindLabs/AgroSphere');
  assert.equal(cards[2].metrics.stars, 20);
  assert.equal(cards[2].provenRank, 3);

  // Card 4: akshaysonvane (stars below fold, provenRank undefined)
  assert.equal(cards[3].entityName, 'akshaysonvane/Climate-Change-Data-Analytics-Visualization');
  assert.equal(cards[3].provenRank, undefined);

  // Verify NO sidebar facet cards exist
  assert.ok(!cards.some(c => c.entityName?.includes('Jupyter') || c.entityName?.includes('TypeScript') || c.entityName?.includes('1.3k')));
});

test('EvidenceLedger: Real ArXiv captured trace regression (obs_1_3.json)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const obsPath = path.resolve('logs/webvoyager-lite/webvoyager_lite_1788032835956/traces/webvoyager_lite_1788032835956_webvoyager_ArXiv__0_a1/observations/obs_1_3.json');
  if (!fs.existsSync(obsPath)) return;

  const obs: BrowserObservation = JSON.parse(fs.readFileSync(obsPath, 'utf8'));
  const activeSort = extractActiveSort(obs.url, obs.refs);
  assert.ok(activeSort);
  assert.equal(activeSort.dimension, 'date');
  assert.equal(activeSort.direction, 'desc');

  const cards = extractResultCards(obs, activeSort);
  assert.ok(cards.length >= 2);
  assert.ok(cards[0].entityName?.startsWith('arXiv:'));
  assert.equal(cards[0].provenRank, 1);
});

test('EvidenceLedger & AnswerContract: Top-ranked entity grounding verification', async () => {
  const { inferAnswerContract, validateAnswerAgainstContract } = await import('../../../src/v2/agent/AnswerContract');
  const goal = 'Find the open-source project related to climate change data visualization with the most stars on GitHub and record its name.';
  const contract = inferAnswerContract(goal);

  const evidenceText = `
[Active Sort: stars (desc) via url_query]
[Card 1: Rank #1 | resource-watch/resource-watch | 73 stars]
[Card 2: Rank #2 | Beckybams/AI-Enhanced-Climate-Education-Tools- | 40 stars]
[Card 3: Rank #3 | WorldWindLabs/AgroSphere | 20 stars]
[Card 4: akshaysonvane/Climate-Change-Data-Analytics-Visualization]
`;

  // 1. Correct answer naming resource-watch passes
  const correct = validateAnswerAgainstContract(
    'The project with the most stars is resource-watch/resource-watch with 73 stars.',
    contract,
    { evidenceText },
  );
  assert.equal(correct.ok, true);

  // 2. Wrong answer naming lower-ranked akshaysonvane is rejected
  const wrong = validateAnswerAgainstContract(
    'The project with the most stars is akshaysonvane/Climate-Change-Data-Analytics-Visualization.',
    contract,
    { evidenceText },
  );
  assert.equal(wrong.ok, false);
  assert.ok(wrong.reasons.includes('answer_does_not_match_top_ranked_evidence'));
});

test('EvidenceLedger: Multi-observation durability preserves search cards across drill-down', () => {
  const ledger = new EvidenceLedger();
  const searchRefs: V2Ref[] = [
    makeRef({
      refId: 'ref_repo_1',
      role: 'link',
      name: 'resource-watch/resource-watch',
      text: 'resource-watch/resource-watch',
      box: { x: 368, y: 85, width: 229, height: 24 },
    }),
    makeRef({
      refId: 'ref_stars_1',
      role: 'link',
      name: '73 stars',
      text: '73',
      box: { x: 427, y: 194.5, width: 35, height: 18 },
    }),
  ];

  // Observation 1: Search results
  const searchObs = makeObservation('obs_search', 'https://github.com/search?q=climate&s=stars&o=desc', searchRefs);
  ledger.recordObservation(searchObs);
  assert.equal(ledger.getResultCards().length, 1);
  assert.equal(ledger.getResultCards()[0].provenRank, 1);

  // Observation 2: Repository details page (no search result cards present)
  const detailRefs: V2Ref[] = [
    makeRef({
      refId: 'ref_readme',
      role: 'heading',
      name: 'Resource Watch API and Data Visualization',
      text: 'Resource Watch API and Data Visualization',
    }),
  ];
  const detailObs = makeObservation('obs_detail', 'https://github.com/resource-watch/resource-watch', detailRefs);
  ledger.recordObservation(detailObs);

  // Search cards are preserved in ledger!
  assert.equal(ledger.getResultCards().length, 1);
  assert.equal(ledger.getResultCards()[0].entityName, 'resource-watch/resource-watch');

  const validationText = ledger.buildValidationEvidenceText();
  assert.ok(validationText.includes('Rank #1'));
  assert.ok(validationText.includes('resource-watch/resource-watch'));
});
