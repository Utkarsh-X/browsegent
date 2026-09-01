import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { BrowserSession } from '../../../src/v2/substrate/BrowserSession';
import { InputService } from '../../../src/v2/substrate/InputService';
import { ObservationService } from '../../../src/v2/substrate/ObservationService';

function fixtureUrl(name: string): string {
  return pathToFileURL(path.resolve('tests/fixtures/v2', name)).toString();
}

test('ObservationService captures basic interactive browser truth from a local fixture', async () => {
  const session = new BrowserSession({ headed: false });
  const observer = new ObservationService();

  try {
    await session.open(fixtureUrl('static-controls.html'));
    const observation = await observer.capture({
      sessionId: 'session_static',
      generationId: 1,
      page: session.currentPage(),
    });

    const names = observation.refs.map(ref => ref.name ?? ref.text ?? '');
    assert.ok(names.includes('Submit form'));
    assert.ok(names.includes('Search docs'));
    assert.ok(names.includes('Read docs'));
    assert.ok(names.includes('Notes'));
    assert.ok(names.includes('Editable notes'));

    const disabled = observation.refs.find(ref => ref.name === 'Disabled action');
    assert.equal(disabled?.actionability, 'disabled');

    const hidden = observation.refs.find(ref => ref.name === 'Hidden action');
    assert.equal(hidden?.visibility, 'hidden');

    const offscreen = observation.refs.find(ref => ref.name === 'Archive link');
    assert.equal(offscreen?.visibility, 'offscreen');

    assert.equal(observation.url, fixtureUrl('static-controls.html'));
    assert.equal(observation.title, 'Static Controls Fixture');
    assert.ok(observation.stats.refCount >= 8);
  } finally {
    await session.close();
  }
});

test('ObservationService gives repeated controls distinct ref and target identities', async () => {
  const session = new BrowserSession({ headed: false });
  const observer = new ObservationService();

  try {
    await session.open(fixtureUrl('repeated-controls.html'));
    const observation = await observer.capture({
      sessionId: 'session_repeated',
      generationId: 3,
      page: session.currentPage(),
    });

    const openButtons = observation.refs.filter(ref => ref.name === 'Open');
    assert.equal(openButtons.length, 3);
    assert.equal(new Set(openButtons.map(ref => ref.refId)).size, 3);
    assert.equal(new Set(openButtons.map(ref => ref.targetId)).size, 3);
    assert.ok(openButtons.every(ref => ref.generationId === 3));
  } finally {
    await session.close();
  }
});

test('InputService opens a closed suggestion control before filling it', async () => {
  const session = new BrowserSession({ headed: false });
  const observer = new ObservationService();

  try {
    await session.open(fixtureUrl('suggestion-gated-combobox.html'));
    const page = session.currentPage();
    const observation = await observer.capture({
      sessionId: 'session_suggestion_gated',
      generationId: 1,
      page,
    });
    const input = observation.refs.find(ref => ref.name === 'Destination');
    assert.ok(input);
    assert.equal(input.ariaAutocomplete, 'list');
    assert.equal(input.ariaHasPopup, 'listbox');
    assert.equal(input.placeholder, undefined);

    const result = await new InputService().type(input, 'Paris', page);
    assert.equal(result.value?.inputValue, 'Paris');
    assert.equal(await page.locator('#destinations').isVisible(), true);
    await page.getByRole('option', { name: 'Paris' }).click();
    await page.locator('button[type="submit"]').click();
    assert.equal(await page.locator('#result').textContent(), 'submitted:Paris');
  } finally {
    await session.close();
  }
});

test('InputService fills a blocked suggestion control before requiring a physical click', async () => {
  const session = new BrowserSession({ headed: false });
  const observer = new ObservationService();

  try {
    await session.open(fixtureUrl('blocked-suggestion-combobox.html'));
    const page = session.currentPage();
    const observation = await observer.capture({
      sessionId: 'session_blocked_suggestion',
      generationId: 1,
      page,
    });
    const input = observation.refs.find(ref => ref.name === 'Destination');
    assert.ok(input);
    assert.equal(input.role, 'combobox');
    assert.equal(input.ariaHasPopup, 'listbox');
    assert.equal(await page.locator('#destination').evaluate(element => {
      const rect = element.getBoundingClientRect();
      return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.id;
    }), 'destination-blocker');

    const result = await new InputService().type(input, 'Paris', page);

    assert.equal(result.value?.inputValue, 'Paris');
    assert.equal(await page.getByRole('option', { name: 'Paris' }).isVisible(), true);
    await page.getByRole('option', { name: 'Paris' }).click();
    await page.locator('button[type="submit"]').click();
    assert.equal(await page.locator('#result').textContent(), 'submitted:Paris');
  } finally {
    await session.close();
  }
});

test('InputService opens a blocked closed suggestion control with keyboard semantics', async () => {
  const session = new BrowserSession({ headed: false });
  const observer = new ObservationService();

  try {
    await session.open(fixtureUrl('keyboard-open-suggestion-combobox.html'));
    const page = session.currentPage();
    const observation = await observer.capture({
      sessionId: 'session_keyboard_open_suggestion',
      generationId: 1,
      page,
    });
    const input = observation.refs.find(ref => ref.name === 'Destination');
    assert.ok(input);

    const result = await new InputService().type(input, 'Paris', page);

    assert.equal(result.value?.inputValue, 'Paris');
    assert.equal(await page.getByRole('option', { name: 'Paris' }).isVisible(), true);
    await page.getByRole('option', { name: 'Paris' }).click();
    await page.locator('button[type="submit"]').click();
    assert.equal(await page.locator('#result').textContent(), 'submitted:Paris');
  } finally {
    await session.close();
  }
});

test('InputService does not reopen a suggestion control with visible options', async () => {
  const session = new BrowserSession({ headed: false });
  const observer = new ObservationService();

  try {
    await session.open(fixtureUrl('search-combobox.html'));
    const page = session.currentPage();
    const observation = await observer.capture({
      sessionId: 'session_open_suggestion_protocol',
      generationId: 1,
      page,
    });
    const input = observation.refs.find(ref => ref.name === 'Search place');
    assert.ok(input);

    await page.locator('#query').evaluate(element => {
      let clicks = 0;
      let keyups = 0;
      element.addEventListener('click', () => { clicks += 1; });
      element.addEventListener('keyup', () => { keyups += 1; });
      (element as HTMLElement & {
        __testClickCount?: () => number;
        __testKeyupCount?: () => number;
      }).__testClickCount = () => clicks;
      (element as HTMLElement & { __testKeyupCount?: () => number }).__testKeyupCount = () => keyups;
    });
    const result = await new InputService().type(input, 'Paris', page);

    assert.equal(result.value?.inputValue, 'Paris');
    assert.equal(await page.locator('#suggestions').isVisible(), true);
    const clickCount = await page.locator('#query').evaluate(element =>
      (element as HTMLElement & { __testClickCount?: () => number }).__testClickCount?.() ?? -1,
    );
    const keyupCount = await page.locator('#query').evaluate(element =>
      (element as HTMLElement & { __testKeyupCount?: () => number }).__testKeyupCount?.() ?? -1,
    );
    assert.equal(clickCount, 0);
    assert.equal(keyupCount, 0);
  } finally {
    await session.close();
  }
});

test('InputService uses keyboard events when fill leaves suggestion options unrelated', async () => {
  const session = new BrowserSession({ headed: false });
  const observer = new ObservationService();

  try {
    await session.open(fixtureUrl('keyboard-filter-combobox.html'));
    const page = session.currentPage();
    const observation = await observer.capture({
      sessionId: 'session_keyboard_filter',
      generationId: 1,
      page,
    });
    const input = observation.refs.find(ref => ref.name === 'Destination');
    assert.ok(input);

    const result = await new InputService().type(input, 'Paris', page);

    assert.equal(result.value?.inputValue, 'Paris');
    assert.equal(await page.getByRole('option', { name: 'Paris' }).isVisible(), true);
    assert.equal(await page.getByRole('option', { name: 'New Delhi' }).isVisible(), false);
  } finally {
    await session.close();
  }
});

test('InputService waits briefly for delayed unrelated suggestions before keyboard fallback', async () => {
  const session = new BrowserSession({ headed: false });
  const observer = new ObservationService();

  try {
    await session.open(fixtureUrl('delayed-keyboard-filter-combobox.html'));
    const page = session.currentPage();
    const observation = await observer.capture({
      sessionId: 'session_delayed_keyboard_filter',
      generationId: 1,
      page,
    });
    const input = observation.refs.find(ref => ref.name === 'Destination');
    assert.ok(input);

    const result = await new InputService().type(input, 'Paris', page);

    assert.equal(result.value?.inputValue, 'Paris');
    assert.equal(await page.getByRole('option', { name: 'Paris' }).isVisible(), true);
    assert.equal(await page.getByRole('option', { name: 'New Delhi' }).isVisible(), false);
    const keyupCount = await page.locator('#destination').evaluate(element =>
      (element as HTMLElement & { __testKeyupCount?: () => number }).__testKeyupCount?.() ?? -1,
    );
    assert.ok(keyupCount > 0);
  } finally {
    await session.close();
  }
});

test('ObservationService can capture a titled page before delayed hydration exposes interactive refs', async () => {
  const session = new BrowserSession({ headed: false });
  const observer = new ObservationService();

  try {
    await session.open(fixtureUrl('delayed-hydration.html'));
    const early = await observer.capture({
      sessionId: 'session_delayed_hydration',
      generationId: 1,
      page: session.currentPage(),
    });

    assert.equal(early.title, 'Delayed Hydration Fixture');
    assert.equal(early.refs.length, 0);

    const hydrated = await observer.capture({
      sessionId: 'session_delayed_hydration',
      generationId: 1,
      page: session.currentPage(),
      retryEmptyNavigationCapture: true,
    });

    assert.equal(hydrated.refs.some(ref => ref.name === 'Hydrated action'), true);
  } finally {
    await session.close();
  }
});
