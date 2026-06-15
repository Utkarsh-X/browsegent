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

test('Layer 2 Invariant: Reference Survival, Layout Shift, Ambiguity, and Negative Recovery', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const observer = new ObservationService();
  const refService = new RefService();
  const resolver = new RefResolver();

  try {
    // 1. React Rerender / Element Replacement Survival
    await page.goto(fixtureUrl('rerender-replacement.html'));
    const obs1 = await observer.capture({ page, sessionId: 's1', generationId: 1 });
    const initialObs = refService.assign(obs1);
    
    const saveRef = initialObs.refs.find(ref => ref.name === 'Save');
    assert.ok(saveRef, 'Save button must be detected');
    
    // Trigger rerender replacement (modifies HTML structure, changes class names, destroys original node)
    await page.evaluate(() => (window as any).replaceControls());
    const obs2 = await observer.capture({ page, sessionId: 's1', generationId: 2 });
    const assigned2 = refService.assign(obs2);

    const matchedSave = assigned2.refs.find(ref => ref.name === 'Save');
    assert.ok(matchedSave, 'Save button should be present in post-rerender observation');
    assert.equal(matchedSave.refId, saveRef.refId, 'Save button must retain its ref ID across replacement');
    assert.equal(matchedSave.state, 'weakened', 'Matching via soft fingerprint degrades state to weakened');

    const resolved = await resolver.resolve(matchedSave, page);
    assert.ok(resolved.locator, 'RefResolver must locate the replaced physical element');

    // 2. Bounding Box Layout Shift (Parent, Sibling, Z-Index and Geometry Shifts)
    await page.setContent(`
      <html>
        <body>
          <div id="container-a" style="z-index: 1;">
            <p>Header</p>
            <button id="target-btn">Click me</button>
          </div>
        </body>
      </html>
    `);
    const obsL1 = await observer.capture({ page, sessionId: 's1', generationId: 3 });
    const assignedL1 = refService.assign(obsL1);
    const targetRef = assignedL1.refs.find(ref => ref.name === 'Click me');
    assert.ok(targetRef);

    // Dynamic mutation: Move 200px down, change parent container, change sibling order, change z-index
    await page.evaluate(() => {
      const btn = document.getElementById('target-btn');
      if (btn) {
        btn.style.marginTop = '200px';
        const containerB = document.createElement('div');
        containerB.id = 'container-b';
        containerB.style.zIndex = '999';
        document.body.appendChild(containerB);
        containerB.appendChild(btn); // Changes parent
      }
    });

    const obsL2 = await observer.capture({ page, sessionId: 's1', generationId: 4 });
    const assignedL2 = refService.assign(obsL2);
    const matchedL2 = assignedL2.refs.find(ref => ref.name === 'Click me');
    assert.ok(matchedL2);
    assert.equal(matchedL2.refId, targetRef.refId, 'Identity must survive geometry, parent, and z-index changes');

    // 3. Ambiguous Recovery (Prevent Silent Incorrect Matching on Multi-Duplicates)
    await page.setContent(`
      <html>
        <body>
          <div id="wrapper">
            <button class="search">Search</button>
            <button class="search">Search</button>
            <button class="search">Search</button>
          </div>
        </body>
      </html>
    `);
    const obsA1 = await observer.capture({ page, sessionId: 's1', generationId: 5 });
    const assignedA1 = refService.assign(obsA1);
    const originalIds = assignedA1.refs.map(r => r.refId);

    // Mutate: Re-create the elements dynamically so hard matching fails, and add a fourth identical button
    await page.evaluate(() => {
      const wrapper = document.getElementById('wrapper');
      if (wrapper) {
        wrapper.innerHTML = `
          <button class="search">Search</button>
          <button class="search">Search</button>
          <button class="search">Search</button>
          <button class="search">Search</button>
        `;
      }
    });

    const obsA2 = await observer.capture({ page, sessionId: 's1', generationId: 6 });
    const assignedA2 = refService.assign(obsA2);

    // Under ambiguity (>1 matches), RefService must assign new IDs instead of silently matching incorrectly
    assignedA2.refs.forEach((ref) => {
      assert.ok(!originalIds.includes(ref.refId), 'Ambiguous duplicate matching must not silently reuse original ref IDs');
    });

    // 4. Negative Recovery (Avoid False Linkage on Semantic Shift)
    await page.setContent(`
      <html>
        <body>
          <button id="action-btn">Delete User</button>
        </body>
      </html>
    `);
    const obsN1 = await observer.capture({ page, sessionId: 's1', generationId: 7 });
    const assignedN1 = refService.assign(obsN1);
    const deleteUserRef = assignedN1.refs.find(ref => ref.name === 'Delete User');
    assert.ok(deleteUserRef);

    // Mutate: replace with similar role but different name ("Delete All Users")
    await page.evaluate(() => {
      const btn = document.getElementById('action-btn');
      if (btn) {
        btn.textContent = 'Delete All Users';
        btn.id = 'action-btn-all';
      }
    });

    const obsN2 = await observer.capture({ page, sessionId: 's1', generationId: 8 });
    const assignedN2 = refService.assign(obsN2);
    const matchedN = assignedN2.refs.find(ref => ref.refId === deleteUserRef.refId);
    
    assert.ok(!matchedN, 'Negative Recovery Invariant: Should never link different semantic nodes (Delete User -> Delete All Users)');

  } finally {
    await browser.close();
  }
});
