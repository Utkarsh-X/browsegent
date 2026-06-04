import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

import { ProjectionService } from '../../../src/v2/brain1/ProjectionService';
import { BrowseGentV2Harness } from '../../../src/v2/harness/BrowseGentV2Harness';
import { PlannerWorkingSetSelector } from '../../../src/v2/planner/PlannerWorkingSetSelector';
import { InputService } from '../../../src/v2/substrate/InputService';

function fixtureUrl(name: string): string {
  return pathToFileURL(path.resolve('tests/fixtures/v2', name)).toString();
}

async function freshTraceDir(name: string): Promise<string> {
  const root = path.join(process.cwd(), 'logs', 'v2-integration-traces', name);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  return root;
}

test('BrowseGentV2Harness observes searchable comboboxes as typeable action-lane refs', async () => {
  const harness = new BrowseGentV2Harness({
    headed: false,
    runId: 'run_search_combobox',
    traceDir: await freshTraceDir('search_combobox'),
  });

  try {
    const observation = await harness.open(fixtureUrl('search-combobox.html'));
    const search = observation.refs.find(ref => ref.name === 'Search place');
    assert.ok(search);
    assert.equal(search.tagName, 'input');
    assert.equal(search.inputType, 'search');
    assert.equal(search.ariaAutocomplete, 'list');
    assert.equal(search.capabilities?.typeable, true);

    const projection = new ProjectionService().project(observation);
    const selection = new PlannerWorkingSetSelector().select({
      goal: 'Search for Paris',
      projection,
    });

    assert.ok(selection.workingSet.actionSurface.typeableRefs.includes(search.refId));
  } finally {
    await harness.close();
  }
});

test('BrowseGentV2Harness captures substrate-only backend node ids for visible controls when CDP is available', async () => {
  const harness = new BrowseGentV2Harness({
    headed: false,
    runId: 'run_backend_identity',
    traceDir: await freshTraceDir('backend_identity'),
  });

  try {
    const observation = await harness.open(fixtureUrl('static-controls.html'));
    const visibleControls = observation.refs.filter(ref => ref.visibility === 'visible');

    assert.ok(visibleControls.length > 0);
    assert.ok(visibleControls.some(ref => typeof ref.backendNodeId === 'number'));
  } finally {
    await harness.close();
  }
});

test('BrowseGentV2Harness clicks the visible semantic match instead of a hidden first selector match', async () => {
  const harness = new BrowseGentV2Harness({
    headed: false,
    runId: 'run_hidden_first_resolution',
    traceDir: await freshTraceDir('hidden_first_resolution'),
  });

  try {
    const observation = await harness.open(fixtureUrl('ambiguous-buttons.html'));
    const search = observation.refs.find(ref => ref.name === 'Search' && ref.visibility === 'visible');
    assert.ok(search);
    assert.equal(search.selectorCandidates[0], 'button.button');

    const result = await harness.click(search.refId);
    const searchResult = await harness.searchPage('searched');

    assert.equal(result.success, true);
    assert.equal(searchResult.value?.matches, 1);
  } finally {
    await harness.close();
  }
});

test('InputService rejects equivalent visible selector matches as ambiguous', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.setContent(`
      <!doctype html>
      <html>
        <body>
          <button class="button">Search</button>
          <button class="button">Search</button>
        </body>
      </html>
    `);

    await assert.rejects(
      () => new InputService().click({
        refId: 'ref_ambiguous_search',
        generationId: 1,
        targetId: 'target_ambiguous_search',
        selectorCandidates: ['button.button'],
        role: 'button',
        tagName: 'button',
        name: 'Search',
        text: 'Search',
        visibility: 'visible',
        actionability: 'ready',
        continuityConfidence: 1,
        state: 'live',
        capabilities: { clickable: true, typeable: false, selectable: false, readable: true },
      }, page),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal((error as { code?: string }).code, 'ambiguous_ref_resolution');
        return true;
      },
    );
  } finally {
    await browser.close();
  }
});

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
    assert.deepEqual(result.target, {
      refId: openModal.refId,
      role: 'button',
      name: 'Open modal',
      text: 'Open modal',
    });
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

test('BrowseGentV2Harness press submits the focused control through normal keyboard semantics', async () => {
  const harness = new BrowseGentV2Harness({
    headed: false,
    runId: 'run_keyboard_submit',
    traceDir: await freshTraceDir('keyboard_submit'),
  });

  try {
    const observation = await harness.open(fixtureUrl('keyboard-submit.html'));
    const query = observation.refs.find(ref => ref.name === 'Search query');
    assert.ok(query);

    const typeResult = await harness.type(query.refId, 'alpha');
    const pressResult = await harness.press('Enter');
    const searchResult = await harness.searchPage('submitted:alpha');

    assert.equal(typeResult.success, true);
    assert.equal(pressResult.success, true);
    assert.equal(pressResult.kind, 'press');
    assert.deepEqual(pressResult.value, { key: 'Enter' });
    assert.equal(searchResult.value?.matches, 1);
  } finally {
    await harness.close();
  }
});

test('BrowseGentV2Harness rejects an occluded click as target_blocked', async () => {
  const traceDir = await freshTraceDir('blocked');
  const harness = new BrowseGentV2Harness({
    headed: false,
    runId: 'run_blocked',
    traceDir,
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
    assert.equal(result.evidence?.beforeObservationId, observation.observationId);
    assert.ok(result.evidence?.afterObservationId);

    const manifest = await harness.flushTrace();
    assert.equal(manifest.steps.length, 1);
    assert.equal(manifest.steps[0].status, 'failed');
    assert.equal(manifest.steps[0].afterObservationId, result.evidence?.afterObservationId);
    assert.equal(manifest.artifacts.observations.length, 2);

    const traceJson = JSON.parse(await readFile(path.join(traceDir, 'run_blocked', 'trace.json'), 'utf8'));
    assert.equal(traceJson.steps[0].result.success, false);
    assert.equal(traceJson.steps[0].result.error.code, 'target_blocked');
    assert.equal(traceJson.steps[0].result.evidence.beforeObservationId, observation.observationId);
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

test('BrowseGentV2Harness get prefers accessible names over generic visible text', async () => {
  const harness = new BrowseGentV2Harness({
    headed: false,
    runId: 'run_get_accessible_name',
    traceDir: await freshTraceDir('get_accessible_name'),
  });

  try {
    const observation = await harness.open(fixtureUrl('virtualized-list.html'));
    const firstItem = observation.refs.find(ref => ref.name === 'Open Item 1');
    assert.ok(firstItem);

    const result = await harness.get(firstItem.refId);

    assert.equal(result.success, true);
    assert.equal(result.value?.text, 'Open Item 1');
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

test('BrowseGentV2Harness observes native select option labels as bounded operational facts', async () => {
  const harness = new BrowseGentV2Harness({
    headed: false,
    runId: 'run_native_select_options',
    traceDir: await freshTraceDir('native_select_options'),
  });

  try {
    const observation = await harness.open(fixtureUrl('native-select.html'));
    const select = observation.refs.find(ref => ref.name === 'Sort order');

    assert.ok(select);
    assert.equal(select.tagName, 'select');
    assert.equal(select.capabilities?.selectable, true);
    assert.deepEqual(select.selectOptions, [
      'Choose sort',
      'Announcement date (newest first)',
      'Announcement date (oldest first)',
      'Relevance',
    ]);
  } finally {
    await harness.close();
  }
});

test('BrowseGentV2Harness selects a native option and records transition evidence', async () => {
  const traceDir = await freshTraceDir('native_select_execute');
  const harness = new BrowseGentV2Harness({
    headed: false,
    runId: 'run_native_select_execute',
    traceDir,
  });

  try {
    const observation = await harness.open(fixtureUrl('native-select.html'));
    const select = observation.refs.find(ref => ref.name === 'Sort order');
    assert.ok(select);

    const result = await harness.select(select.refId, 'Announcement date (newest first)');
    const searchResult = await harness.searchPage('selected:Announcement date (newest first)');
    const manifest = await harness.flushTrace();

    assert.equal(result.success, true);
    assert.equal(result.kind, 'select');
    assert.equal(result.targetRef, select.refId);
    assert.deepEqual(result.value, {
      value: 'newest',
      selectedText: 'Announcement date (newest first)',
    });
    assert.ok(result.evidence?.afterObservationId);
    assert.equal(searchResult.value?.matches, 1);
    assert.ok(manifest.steps.find(step => step.kind === 'select')?.afterObservationId);
  } finally {
    await harness.close();
  }
});
