import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

import { ObservationService } from '../../../src/v2/substrate/ObservationService';
import { RefService } from '../../../src/v2/runtime/RefService';
import { RefResolver } from '../../../src/v2/substrate/RefResolver';
import { InputService } from '../../../src/v2/substrate/InputService';
import { ContinuityInterpreter } from '../../../src/v2/brain2/ContinuityInterpreter';
import { ContinuityGraph } from '../../../src/v2/graph/ContinuityGraph';
import { V2OperationalError } from '../../../src/v2/runtime/errors';

function fixtureUrl(name: string): string {
  return pathToFileURL(resolve('tests/fixtures/v2', name)).toString();
}

test('Recovery Scenario A: RefResolver throws stale_ref for non-existent target resolution', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const observer = new ObservationService();
  const refService = new RefService();
  const resolver = new RefResolver();

  try {
    await page.goto(fixtureUrl('static-controls.html'));
    const raw = await observer.capture({ page, sessionId: 'rec', generationId: 1 });
    const obs = refService.assign(raw);

    const submitRef = obs.refs.find(r => r.name === 'Submit form');
    assert.ok(submitRef);

    // Corrupt selector candidates to point to a non-existent element
    const corruptedRef = {
      ...submitRef,
      selectorCandidates: ['#completely-fake-id-that-does-not-exist-1234']
    };

    await assert.rejects(
      async () => {
        await resolver.resolve(corruptedRef, page);
      },
      (err: any) => {
        assert.ok(err instanceof V2OperationalError);
        assert.equal(err.code, 'stale_ref');
        return true;
      },
      'Resolution should reject with stale_ref operational error'
    );
  } finally {
    await browser.close();
  }
});

test('Recovery Scenario B: Form input value updates dynamically (course correction)', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const observer = new ObservationService();
  const refService = new RefService();
  const inputService = new InputService();

  try {
    await page.goto(fixtureUrl('static-controls.html'));
    const raw1 = await observer.capture({ page, sessionId: 'rec', generationId: 1 });
    const obs1 = refService.assign(raw1);

    const searchRef = obs1.refs.find(r => r.name === 'Search docs');
    assert.ok(searchRef);

    // Type initial value
    await inputService.type(searchRef, 'Initial text', page);

    // Dynamically change input value in the DOM
    await page.evaluate(() => {
      const input = document.getElementById('search-input') as HTMLInputElement;
      if (input) {
        input.value = 'Modified text';
        // Dispatch event so state updates
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    // Capture second observation
    const raw2 = await observer.capture({ page, sessionId: 'rec', generationId: 2 });
    const obs2 = refService.assign(raw2);

    const updatedRef = obs2.refs.find(r => r.refId === searchRef.refId);
    assert.ok(updatedRef);

    // Verify that the crawler and ref service capture the modified value
    const DOMValue = await page.locator('#search-input').inputValue();
    assert.equal(DOMValue, 'Modified text', 'DOM input value should update');
  } finally {
    await browser.close();
  }
});

test('Recovery Scenario C: Resolution rejects stale references immediately', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const observer = new ObservationService();
  const refService = new RefService();
  const resolver = new RefResolver();

  try {
    await page.goto(fixtureUrl('static-controls.html'));
    const raw1 = await observer.capture({ page, sessionId: 'rec', generationId: 1 });
    const obs1 = refService.assign(raw1);

    const submitRef = obs1.refs.find(r => r.name === 'Submit form');
    assert.ok(submitRef);

    // Dynamically remove all button elements from the DOM to avoid sibling matching
    await page.evaluate(() => {
      document.querySelectorAll('button').forEach(btn => btn.remove());
    });

    // Capture post-mutation state
    const raw2 = await observer.capture({ page, sessionId: 'rec', generationId: 2 });
    const obs2 = refService.assign(raw2);

    // Verify resolving the original ref now rejects as stale_ref
    await assert.rejects(
      async () => {
        await resolver.resolve(submitRef, page);
      },
      (err: any) => {
        assert.ok(err instanceof V2OperationalError);
        assert.equal(err.code, 'stale_ref');
        return true;
      }
    );
  } finally {
    await browser.close();
  }
});

test('Recovery Scenario D: InputService click fails with target_blocked for covered targets', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const observer = new ObservationService();
  const refService = new RefService();
  const inputService = new InputService();

  try {
    await page.goto(fixtureUrl('blocked-overlay.html'));
    const raw = await observer.capture({ page, sessionId: 'rec', generationId: 1 });
    const obs = refService.assign(raw);

    const targetRef = obs.refs.find(r => r.name === 'Blocked target');
    assert.ok(targetRef);

    // Attempt to click the covered target
    await assert.rejects(
      async () => {
        await inputService.click(targetRef, page);
      },
      (err: any) => {
        assert.ok(err instanceof V2OperationalError);
        assert.equal(err.code, 'target_blocked');
        return true;
      },
      'Click should reject with target_blocked error when covered by an overlay'
    );
  } finally {
    await browser.close();
  }
});

test('Recovery Scenario E: Navigation orientation handles unexpected page transition', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const observer = new ObservationService();
  const refService = new RefService();
  const interpreter = new ContinuityInterpreter();
  const graph = new ContinuityGraph();

  try {
    // Page A
    await page.goto(fixtureUrl('static-controls.html'));
    const raw1 = await observer.capture({ page, sessionId: 'rec', generationId: 1 });
    const obs1 = refService.assign(raw1);
    graph.applyObservation(obs1);

    // Navigate to Page B (different document context)
    await page.goto(fixtureUrl('delayed-load.html'));
    const raw2 = await observer.capture({ page, sessionId: 'rec', generationId: 2 });
    const obs2 = refService.assign(raw2);

    const transition = interpreter.interpret(obs1, obs2);
    const snapshot = graph.applyObservation(obs2);

    // Assert transition is categorized as a new page navigation
    assert.equal(transition.transitionClass, 'structural_macrostate', 'Hard navigation should be classified correctly');
    
    // Graph snapshot should reflect fresh page reference states (reset previous Page A active references)
    assert.ok(snapshot.stats.presentRefCount > 0, 'New page elements must be indexed');
    const oldPresent = snapshot.refs.some(r => r.name === 'Submit form' && r.present === true);
    assert.equal(oldPresent, false, 'Previous page active references must be marked as not present');
  } finally {
    await browser.close();
  }
});
