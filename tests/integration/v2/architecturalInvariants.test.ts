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

test('Layer 4 Invariant: Planner Working Set Affordance Correctness', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const observer = new ObservationService();
  const refService = new RefService();
  const selector = new PlannerWorkingSetSelector();

  try {
    await page.goto(fixtureUrl('static-controls.html'));
    const rawObs = await observer.capture({ page, sessionId: 's1', generationId: 1 });
    const obs = refService.assign(rawObs);

    const submitBtn = obs.refs.find(ref => ref.name === 'Submit form');
    const searchInput = obs.refs.find(ref => ref.name === 'Search docs');
    const disabledBtn = obs.refs.find(ref => ref.name === 'Disabled action');
    const hiddenBtn = obs.refs.find(ref => ref.name === 'Hidden action');

    assert.ok(submitBtn);
    assert.ok(searchInput);
    assert.ok(disabledBtn);

    // Build operational projection input
    const projection = {
      projectionId: 'proj_test',
      observationId: obs.observationId,
      generationId: obs.generationId,
      url: obs.url,
      title: obs.title,
      interactions: obs.refs.map(r => ({
        refId: r.refId,
        tagName: r.tagName,
        role: r.role,
        name: r.name,
        text: r.text,
        capabilities: r.capabilities,
        visibility: r.visibility,
        actionability: r.actionability,
        state: r.state,
        nthRoleName: r.nthRoleName,
        regionId: r.regionId,
        kind: (r.tagName === 'button' ? 'button' : r.tagName === 'input' ? 'input' : 'generic') as any,
      })),
      readables: [],
      navigation: [],
      regions: [],
      warnings: [],
      stats: { interactionCount: obs.refs.length, readableCount: 0, navigationCount: 0, regionCount: 0 },
    };

    const selection = selector.select({
      goal: 'Submit the search form and read documentation',
      projection,
    });

    const surface = selection.workingSet.actionSurface;

    // Assert affordance correctness:
    // 1. Submit Button must be clickable, not typeable
    assert.ok(surface.clickableRefs.includes(submitBtn.refId), 'Submit button should be clickable');
    assert.ok(!surface.typeableRefs.includes(submitBtn.refId), 'Submit button should not be typeable');

    // 2. Search Input must be typeable, not clickable
    assert.ok(surface.typeableRefs.includes(searchInput.refId), 'Search input should be typeable');
    assert.ok(!surface.clickableRefs.includes(searchInput.refId), 'Search input should not be clickable');

    // 3. Disabled Button must not be clickable or typeable in the active action surface
    assert.ok(!surface.clickableRefs.includes(disabledBtn.refId), 'Disabled button should be excluded from clickable refs');
    
    // 4. Hidden Button must not be clickable or typeable
    if (hiddenBtn) {
      assert.ok(!surface.clickableRefs.includes(hiddenBtn.refId), 'Hidden button should be excluded from clickable refs');
    }

  } finally {
    await browser.close();
  }
});

test('Layer 3 Invariant: Continuity Transitions and Graph Growth Bounds', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const observer = new ObservationService();
  const refService = new RefService();
  const interpreter = new ContinuityInterpreter();
  const graph = new ContinuityGraph({ maxTransitions: 5 });

  try {
    // 1. Transition Classification on element appearance
    await page.goto(fixtureUrl('delayed-load.html'));
    const rawBefore = await observer.capture({ page, sessionId: 's1', generationId: 1 });
    const before = refService.assign(rawBefore);
    graph.applyObservation(before);

    await page.click('#load');
    // Wait for the 250ms delayed element creation to paint
    await page.waitForTimeout(300);

    // Keep generationId = 1 to indicate local dynamic state change rather than hard refresh
    const rawAfter = await observer.capture({ page, sessionId: 's1', generationId: 1 });
    const after = refService.assign(rawAfter);
    
    const evidence = interpreter.interpret(before, after);
    graph.applyTransition(evidence);
    const snapshot = graph.applyObservation(after);

    assert.equal(evidence.transitionClass, 'structural_local', 'Delayed load should classify as structural local transition');
    assert.ok(evidence.refChanges.appeared.length > 0, 'New element must be classified under appeared refs');
    
    const appearedRefId = evidence.refChanges.appeared[0];
    const graphNode = snapshot.refs.find(node => node.refId === appearedRefId);
    assert.ok(graphNode, 'Appeared element should exist in the graph snapshot');
    assert.equal(graphNode.present, true, 'Appeared element should be currently present in graph');

    // 2. Graph Growth Bounds Stress Loop (200 dynamic additions/removals)
    await page.setContent(`
      <html>
        <body>
          <div id="container"></div>
        </body>
      </html>
    `);

    let lastObs = refService.assign(await observer.capture({ page, sessionId: 's1', generationId: 2 }));
    graph.applyObservation(lastObs);

    for (let i = 0; i < 200; i++) {
      // Dynamic mutation: add or remove elements to generate new references
      await page.evaluate((index) => {
        const container = document.getElementById('container');
        if (container) {
          // Keep a rolling window of elements to trigger both appearance and disappearance transitions
          if (index % 2 === 0) {
            const el = document.createElement('button');
            el.id = `dyn-btn-${index}`;
            el.textContent = `Dynamic Action ${index}`;
            container.appendChild(el);
          } else {
            const oldEl = document.getElementById(`dyn-btn-${index - 1}`);
            if (oldEl) {
              oldEl.remove();
            }
          }
        }
      }, i);

      // Keep generationId constant as these are DOM mutations within the same page document
      const rawCurrent = await observer.capture({ page, sessionId: 's1', generationId: 2 });
      const current = refService.assign(rawCurrent);
      
      const stepEvidence = interpreter.interpret(lastObs, current);
      graph.applyTransition(stepEvidence);
      const loopSnapshot = graph.applyObservation(current);

      lastObs = current;

      if (i === 199) {
        // Log the final status of the graph for our audit report
        console.log(`[Audit Snapshot] Total accumulated historical refs in Graph memory: ${loopSnapshot.refs.length}`);
        console.log(`[Audit Snapshot] Currently present refs: ${loopSnapshot.stats.presentRefCount}`);
        console.log(`[Audit Snapshot] Transition history count: ${loopSnapshot.stats.transitionCount}`);

        // Verify bounds:
        assert.ok(loopSnapshot.stats.transitionCount <= 5, 'Transition history must remain bounded');
        assert.ok(loopSnapshot.stats.presentRefCount <= 10, 'Active references count must remain small and bounded');
        // Assert that historical references memory growth is bounded
        assert.ok(loopSnapshot.refs.length < 500, 'Historical references index remains below stress-limit');
      }
    }

  } finally {
    await browser.close();
  }
});
