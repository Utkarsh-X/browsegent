import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

import { ObservationService } from '../../../src/v2/substrate/ObservationService';
import { RefService } from '../../../src/v2/runtime/RefService';
import { RefResolver } from '../../../src/v2/substrate/RefResolver';
import { ContinuityInterpreter } from '../../../src/v2/brain2/ContinuityInterpreter';
import { ContinuityGraph } from '../../../src/v2/graph/ContinuityGraph';
import { PlannerWorkingSetSelector } from '../../../src/v2/planner/PlannerWorkingSetSelector';

function fixtureUrl(name: string): string {
  return pathToFileURL(resolve('tests/fixtures/v2', name)).toString();
}

test('Harness Setup: Browser launches and opens fixture', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(fixtureUrl('static-controls.html'));
    const title = await page.title();
    assert.equal(title, 'Static Controls Fixture');
  } finally {
    await browser.close();
  }
});

test('Layer 1 Invariant: Observation Coverage, Hidden Filtering, and Actionability', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const observer = new ObservationService();
  
  try {
    // 1. Coverage & Capabilities Check
    await page.goto(fixtureUrl('static-controls.html'));
    const obs = await observer.capture({ page, sessionId: 's1', generationId: 1 });
    
    // Verify standard controls are detected
    const submitBtn = obs.refs.find(ref => ref.name === 'Submit form');
    assert.ok(submitBtn, 'Submit form button should be observed');
    assert.equal(submitBtn.tagName, 'button');
    assert.equal(submitBtn.capabilities?.clickable, true, 'Button should be clickable');
    assert.equal(submitBtn.capabilities?.typeable, false, 'Button should not be typeable');

    const searchInput = obs.refs.find(ref => ref.name === 'Search docs');
    assert.ok(searchInput, 'Search input field should be observed');
    assert.equal(searchInput.tagName, 'input');
    assert.equal(searchInput.capabilities?.typeable, true, 'Input should be typeable');
    assert.equal(searchInput.capabilities?.clickable, false, 'Text input should not be clickable');

    const docsLink = obs.refs.find(ref => ref.name === 'Read docs');
    assert.ok(docsLink, 'Read docs link should be observed');
    assert.equal(docsLink.tagName, 'a');
    assert.equal(docsLink.capabilities?.clickable, true, 'Link should be clickable');

    const categorySelect = obs.refs.find(ref => ref.tagName === 'select');
    assert.ok(categorySelect, 'Select dropdown should be observed');
    assert.equal(categorySelect.capabilities?.selectable, true, 'Dropdown select must be selectable');

    const notesArea = obs.refs.find(ref => ref.name === 'Notes');
    assert.ok(notesArea, 'Notes textarea should be observed');
    assert.equal(notesArea.tagName, 'textarea');
    assert.equal(notesArea.capabilities?.typeable, true, 'Textarea must be typeable');

    // 2. Hidden Element Filtering
    const hiddenBtn = obs.refs.find(ref => ref.name === 'Hidden action');
    if (hiddenBtn) {
      assert.equal(hiddenBtn.visibility, 'hidden', 'Hidden button should have hidden visibility state');
    }

    // 3. Actionability Status
    const disabledBtn = obs.refs.find(ref => ref.name === 'Disabled action');
    assert.ok(disabledBtn, 'Disabled button should be observed');
    assert.equal(disabledBtn.actionability, 'disabled', 'Disabled button must report disabled actionability status');
    assert.equal(disabledBtn.capabilities?.clickable, true, 'Disabled button remains intrinsically clickable');

  } finally {
    await browser.close();
  }
});
