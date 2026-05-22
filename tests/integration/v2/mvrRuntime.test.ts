import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { BrowseGentV2Harness } from '../../../src/v2/harness/BrowseGentV2Harness';

function fixtureUrl(name: string): string {
  return pathToFileURL(path.resolve('tests/fixtures/v2', name)).toString();
}

async function freshTraceDir(name: string): Promise<string> {
  const root = path.join(process.cwd(), 'logs', 'v2-integration-traces', name);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  return root;
}

test('BrowseGentV2Harness click opens a modal and records structural local evidence', async () => {
  const traceDir = await freshTraceDir('modal');
  const harness = new BrowseGentV2Harness({
    headed: false,
    runId: 'run_modal',
    traceDir,
  });

  try {
    const observation = await harness.open(fixtureUrl('modal-transition.html'));
    const openModal = observation.refs.find(ref => ref.name === 'Open modal');
    assert.ok(openModal);

    const result = await harness.click(openModal.refId);

    assert.equal(result.success, true);
    assert.equal(result.kind, 'click');
    assert.equal(result.targetRef, openModal.refId);
    assert.equal(result.evidence?.transitionClass, 'structural_local');
    assert.equal(result.evidence?.strength, 'moderate');
    assert.ok(result.evidence?.refChanges.appeared.length);
  } finally {
    await harness.close();
  }
});

test('BrowseGentV2Harness type mutates an input and emits operational transition evidence', async () => {
  const harness = new BrowseGentV2Harness({
    headed: false,
    runId: 'run_type',
    traceDir: await freshTraceDir('type'),
  });

  try {
    const observation = await harness.open(fixtureUrl('modal-transition.html'));
    const input = observation.refs.find(ref => ref.selectorCandidates.includes('#name-input'));
    assert.ok(input);

    const result = await harness.type(input.refId, 'Ada Lovelace');

    assert.equal(result.success, true);
    assert.equal(result.kind, 'type');
    assert.deepEqual(result.value, { inputValue: 'Ada Lovelace' });
    assert.ok(['weak', 'moderate'].includes(result.evidence?.strength ?? ''));
  } finally {
    await harness.close();
  }
});

test('BrowseGentV2Harness rejects an occluded click as target_blocked', async () => {
  const harness = new BrowseGentV2Harness({
    headed: false,
    runId: 'run_blocked',
    traceDir: await freshTraceDir('blocked'),
  });

  try {
    const observation = await harness.open(fixtureUrl('blocked-overlay.html'));
    const target = observation.refs.find(ref => ref.name === 'Blocked target');
    assert.ok(target);

    const result = await harness.click(target.refId);

    assert.equal(result.success, false);
    assert.equal(result.error?.code, 'target_blocked');
    assert.equal(result.error?.retryable, false);
    assert.equal(result.targetRef, target.refId);
  } finally {
    await harness.close();
  }
});

test('BrowseGentV2Harness rejects a stale ref without selector guessing', async () => {
  const harness = new BrowseGentV2Harness({
    headed: false,
    runId: 'run_stale',
    traceDir: await freshTraceDir('stale'),
  });

  try {
    const first = await harness.open(fixtureUrl('modal-transition.html'));
    const staleTarget = first.refs.find(ref => ref.name === 'Open modal');
    assert.ok(staleTarget);

    await harness.open(fixtureUrl('blocked-overlay.html'));
    const result = await harness.click(staleTarget.refId);

    assert.equal(result.success, false);
    assert.equal(result.error?.code, 'stale_ref');
  } finally {
    await harness.close();
  }
});

test('BrowseGentV2Harness trace replay links before and after observations for a mutation', async () => {
  const traceDir = await freshTraceDir('trace');
  const harness = new BrowseGentV2Harness({
    headed: false,
    runId: 'run_trace_mutation',
    traceDir,
  });

  try {
    const observation = await harness.open(fixtureUrl('modal-transition.html'));
    const openModal = observation.refs.find(ref => ref.name === 'Open modal');
    assert.ok(openModal);

    const result = await harness.click(openModal.refId);
    const manifest = await harness.flushTrace();

    assert.equal(manifest.steps.length, 1);
    assert.equal(manifest.steps[0].stepId, result.traceStepId);
    assert.equal(manifest.steps[0].beforeObservationId, result.evidence?.beforeObservationId);
    assert.equal(manifest.steps[0].afterObservationId, result.evidence?.afterObservationId);
    assert.equal(manifest.artifacts.observations.length, 2);

    const traceJson = JSON.parse(await readFile(path.join(traceDir, 'run_trace_mutation', 'trace.json'), 'utf8'));
    assert.equal(traceJson.steps[0].result.success, true);
    assert.equal(traceJson.steps[0].result.evidence.transitionClass, 'structural_local');
  } finally {
    await harness.close();
  }
});

test('BrowseGentV2Harness read-only tools expose bounded operational evidence and trace steps', async () => {
  const traceDir = await freshTraceDir('read_tools');
  const harness = new BrowseGentV2Harness({
    headed: false,
    runId: 'run_read_tools',
    traceDir,
  });

  try {
    const observation = await harness.open(fixtureUrl('static-controls.html'));
    const submit = observation.refs.find(ref => ref.name === 'Submit form');
    assert.ok(submit);

    const getResult = await harness.get(submit.refId);
    const inspectResult = await harness.inspectRegion(submit.refId);
    const searchResult = await harness.searchPage('Static controls');
    const manifest = await harness.flushTrace();

    assert.equal(getResult.success, true);
    assert.equal(getResult.kind, 'get');
    assert.equal(getResult.targetRef, submit.refId);
    assert.match(getResult.value?.text ?? '', /Submit form/);

    assert.equal(inspectResult.success, true);
    assert.equal(inspectResult.kind, 'inspect_region');
    assert.equal(inspectResult.targetRef, submit.refId);
    assert.ok(inspectResult.value?.nearbyRefs.length);

    assert.equal(searchResult.success, true);
    assert.equal(searchResult.kind, 'search_page');
    assert.equal(searchResult.value?.matches, 1);
    assert.match(searchResult.value?.preview[0] ?? '', /Static controls/);

    assert.equal(manifest.steps.length, 3);
    assert.deepEqual(manifest.steps.map(step => step.kind), ['get', 'inspect_region', 'search_page']);
    assert.equal(manifest.steps.every(step => step.status === 'completed'), true);
  } finally {
    await harness.close();
  }
});

test('BrowseGentV2Harness scroll and wait reobserve with operational evidence', async () => {
  const harness = new BrowseGentV2Harness({
    headed: false,
    runId: 'run_scroll_wait',
    traceDir: await freshTraceDir('scroll_wait'),
  });

  try {
    await harness.open(fixtureUrl('static-controls.html'));

    const scrollResult = await harness.scroll('down');
    const waitResult = await harness.waitForState({ pattern: 'Read docs', timeout: 100 });
    const manifest = await harness.flushTrace();

    assert.equal(scrollResult.success, true);
    assert.equal(scrollResult.kind, 'scroll');
    assert.equal(scrollResult.value?.direction, 'down');
    assert.ok(scrollResult.evidence?.beforeObservationId);
    assert.ok(scrollResult.evidence?.afterObservationId);

    assert.equal(waitResult.success, true);
    assert.equal(waitResult.kind, 'wait');
    assert.equal(waitResult.value?.matched, true);
    assert.ok(manifest.steps.find(step => step.kind === 'scroll')?.afterObservationId);
    assert.ok(manifest.steps.find(step => step.kind === 'wait')?.afterObservationId);
  } finally {
    await harness.close();
  }
});

test('BrowseGentV2Harness navigate records a macro transition with before and after observations', async () => {
  const traceDir = await freshTraceDir('navigate');
  const harness = new BrowseGentV2Harness({
    headed: false,
    runId: 'run_navigate',
    traceDir,
  });

  try {
    const before = await harness.open(fixtureUrl('static-controls.html'));

    const result = await harness.navigate(fixtureUrl('modal-transition.html'));
    const manifest = await harness.flushTrace();

    assert.equal(result.success, true);
    assert.equal(result.kind, 'navigate');
    assert.equal(result.value?.url, fixtureUrl('modal-transition.html'));
    assert.equal(result.evidence?.transitionClass, 'structural_macrostate');
    assert.equal(result.evidence?.strength, 'strong');
    assert.equal(result.evidence?.generationChanged, true);
    assert.equal(result.evidence?.urlChanged, true);

    const navigateStep = manifest.steps.find(step => step.kind === 'navigate');
    assert.ok(navigateStep);
    assert.equal(navigateStep.beforeObservationId, before.observationId);
    assert.equal(navigateStep.afterObservationId, result.evidence?.afterObservationId);
    assert.equal(manifest.artifacts.observations.length, 2);
  } finally {
    await harness.close();
  }
});

test('BrowseGentV2Harness rejects unsafe navigate URLs without browser mutation', async () => {
  const traceDir = await freshTraceDir('navigate_unsafe');
  const harness = new BrowseGentV2Harness({
    headed: false,
    runId: 'run_navigate_unsafe',
    traceDir,
  });

  try {
    const before = await harness.open(fixtureUrl('static-controls.html'));

    const result = await harness.navigate('javascript:document.body.remove()');
    const after = await harness.observe();
    const manifest = await harness.flushTrace();

    assert.equal(result.success, false);
    assert.equal(result.kind, 'navigate');
    assert.equal(result.error?.code, 'unsupported_url');
    assert.equal(after.url, before.url);
    assert.equal(after.generationId, before.generationId);

    const navigateStep = manifest.steps.find(step => step.kind === 'navigate');
    assert.ok(navigateStep);
    assert.equal(navigateStep.status, 'failed');
    assert.equal(navigateStep.afterObservationId, undefined);
  } finally {
    await harness.close();
  }
});
