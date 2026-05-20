import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { BrowserSession } from '../../../src/v2/substrate/BrowserSession';
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
