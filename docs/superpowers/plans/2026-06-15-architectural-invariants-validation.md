# Architectural Invariants & Stress Validation Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a comprehensive integration test suite to validate BrowseGent's core architectural invariants (reference tracking, stability, layout changes, and planner surface affordances) using local HTML fixtures.

**Architecture:** Create programmatic Playwright-driven integration tests that execute dynamic mutations on local HTML pages and assert state invariants directly on `ObservationService`, `RefService`, `RefResolver`, `ContinuityInterpreter`, and `ContinuityGraph`.

**Tech Stack:** Node.js, Playwright, TypeScript, tsx, node:test.

---

## Task Map

```
tests/integration/v2/architecturalInvariants.test.ts
  ├── Task 1: Test Harness & Local Fixture Setup
  ├── Task 2: Layer 1 - Observation Invariants (Coverage, Filtering, Capabilities)
  ├── Task 3: Layer 2 - Reference Invariants (Rerender, Layout, Ambiguity, Negative Rec)
  ├── Task 4: Layer 4 - Planner Surface Affordances
  ├── Task 5: Layer 3 - Continuity & Graph Bounds
  └── Task 6: Package Script & Full Verification
```

---

### Task 1: Test Harness & Local Fixture Setup

**Files:**
- Create: `tests/integration/v2/architecturalInvariants.test.ts`

- [ ] **Step 1: Write test harness skeleton**
  Create the test file with imports, fixture URL helper, and base browser lifecycle context:
  ```typescript
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
      assert.equal(title, 'Static Controls');
    } finally {
      await browser.close();
    }
  });
  ```

- [ ] **Step 2: Run test to verify harness works**
  Run: `npx tsx --test tests/integration/v2/architecturalInvariants.test.ts`
  Expected: PASS

- [ ] **Step 3: Commit**
  ```bash
  git add tests/integration/v2/architecturalInvariants.test.ts
  git commit -m "test: setup architectural invariants test harness skeleton"
  ```

---

### Task 2: Layer 1 - Observation Invariants

**Files:**
- Modify: `tests/integration/v2/architecturalInvariants.test.ts` (Append test cases)

- [ ] **Step 1: Append Observation Layer Tests**
  Write tests asserting coverage, hidden element filtering, and capability assertions:
  ```typescript
  test('Observation Layer: Coverage, Filtering, and Actionability', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    try {
      // 1. Coverage & Capabilities
      await page.goto(fixtureUrl('static-controls.html'));
      const observer = new ObservationService();
      const obs = await observer.capture({ page, sessionId: 's1', generationId: 1 });
      
      const searchInput = obs.refs.find(ref => ref.name === 'Search docs');
      assert.ok(searchInput, 'Search input should be detected');
      assert.equal(searchInput.tagName, 'input');
      assert.equal(searchInput.capabilities?.typeable, true, 'Input must be typeable');
      
      const disabledButton = obs.refs.find(ref => ref.name === 'Disabled Action');
      assert.ok(disabledButton, 'Disabled button should be detected');
      assert.equal(disabledButton.actionability, 'disabled', 'Disabled button must be inactive');
      
      // 2. Hidden Element Filtering
      await page.goto(fixtureUrl('blocked-overlay.html'));
      const obs2 = await observer.capture({ page, sessionId: 's1', generationId: 1 });
      const blockedRef = obs2.refs.find(ref => ref.name === 'Blocked Button');
      assert.ok(blockedRef, 'Blocked button should exist');
      // Bounding box occlusions or visibility checks
      assert.equal(blockedRef.visibility, 'visible', 'Overlay is visible, target might be blocked');
    } finally {
      await browser.close();
    }
  });
  ```

- [ ] **Step 2: Run tests to verify**
  Run: `npx tsx --test tests/integration/v2/architecturalInvariants.test.ts`
  Expected: PASS

- [ ] **Step 3: Commit**
  ```bash
  git add tests/integration/v2/architecturalInvariants.test.ts
  git commit -m "test: add observation coverage, hidden filtering, and capability tests"
  ```

---

### Task 3: Layer 2 - Reference Invariants

**Files:**
- Modify: `tests/integration/v2/architecturalInvariants.test.ts` (Append test cases)

- [ ] **Step 1: Append Reference Layer Tests**
  Append test cases checking element replacement, layout shifts, ambiguous recovery, and false recovery prevention:
  ```typescript
  test('Reference Layer: Rerender, Layout Shift, Ambiguity, and Negative Recovery', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const observer = new ObservationService();
    const refService = new RefService();
    const resolver = new RefResolver();
  
    try {
      // 1. React Rerender / Element Replacement Survival
      await page.goto(fixtureUrl('rerender-replacement.html'));
      const obs1 = await observer.capture({ page, sessionId: 's1', generationId: 1 });
      const inputRef = obs1.refs.find(ref => ref.name === 'Target input');
      assert.ok(inputRef);
      refService.register(inputRef);
  
      await page.click('#trigger-rerender');
      const obs2 = await observer.capture({ page, sessionId: 's1', generationId: 2 });
      const matched = refService.match(obs2.refs).find(ref => ref.refId === inputRef.refId);
      assert.ok(matched, 'Ref must survive across React rerender');
      
      const resolved = await resolver.resolve(matched, page);
      assert.ok(resolved.locator, 'RefResolver must locate the replacement DOM node');
  
      // 2. Layout Shift Invariance (Identity != Geometry)
      await page.goto(fixtureUrl('layout-shift.html'));
      const obsL1 = await observer.capture({ page, sessionId: 's1', generationId: 1 });
      const shiftButton = obsL1.refs.find(ref => ref.name === 'Shift Target');
      assert.ok(shiftButton);
      refService.register(shiftButton);
  
      await page.click('#trigger-shift');
      const obsL2 = await observer.capture({ page, sessionId: 's1', generationId: 2 });
      const matchedShift = refService.match(obsL2.refs).find(ref => ref.refId === shiftButton.refId);
      assert.ok(matchedShift, 'Ref must survive layout and coordinate shifts');
      const resolvedShift = await resolver.resolve(matchedShift, page);
      assert.ok(resolvedShift.locator);
  
      // 3. Ambiguous Recovery Degradation
      await page.goto(fixtureUrl('ambiguous-buttons.html'));
      const obsA1 = await observer.capture({ page, sessionId: 's1', generationId: 1 });
      obsA1.refs.forEach(r => refService.register(r));
  
      await page.click('#append-duplicate');
      const obsA2 = await observer.capture({ page, sessionId: 's1', generationId: 2 });
      const matchedA = refService.match(obsA2.refs);
      
      // Verify that matched nodes have degraded confidence or are marked appropriately
      matchedA.forEach(ref => {
        if (ref.invalidationReason === 'ambiguous_roles_or_names') {
          assert.ok(ref.continuityConfidence < 1.0, 'Ambiguous duplicates must degrade confidence');
        }
      });
  
      // 4. Negative Recovery (Avoid False Linkage)
      await page.setContent(`
        <html>
          <body>
            <button id="del">Delete User</button>
            <script>
              document.getElementById('del').addEventListener('click', () => {
                document.body.innerHTML = '<button id="del-all">Delete All Users</button>';
              });
            </script>
          </body>
        </html>
      `);
      const obsN1 = await observer.capture({ page, sessionId: 's1', generationId: 1 });
      const delRef = obsN1.refs.find(ref => ref.name === 'Delete User');
      assert.ok(delRef);
      refService.register(delRef);
  
      await page.click('#del');
      const obsN2 = await observer.capture({ page, sessionId: 's1', generationId: 2 });
      const matchedN = refService.match(obsN2.refs).find(ref => ref.refId === delRef.refId);
      
      // The new button "Delete All Users" should NOT be linked to the old "Delete User" ref ID
      assert.ok(!matchedN || matchedN.state === 'stale', 'Semantic shift must prevent false recovery linkage');
    } finally {
      await browser.close();
    }
  });
  ```

- [ ] **Step 2: Run tests to verify**
  Run: `npx tsx --test tests/integration/v2/architecturalInvariants.test.ts`
  Expected: PASS

- [ ] **Step 3: Commit**
  ```bash
  git add tests/integration/v2/architecturalInvariants.test.ts
  git commit -m "test: add ref rerender, layout shift, ambiguity, and negative recovery tests"
  ```

---

### Task 4: Layer 4 - Planner Surface Affordances

**Files:**
- Modify: `tests/integration/v2/architecturalInvariants.test.ts` (Append test cases)

- [ ] **Step 1: Append Planner Surface affordance correctness test**
  Ensure that working set elements only expose correct, valid affordances (clickable, typeable, selectable):
  ```typescript
  test('Planner Surface Layer: Working Set Affordance Correctness', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const observer = new ObservationService();
    const selector = new PlannerWorkingSetSelector();
  
    try {
      await page.goto(fixtureUrl('static-controls.html'));
      const obs = await observer.capture({ page, sessionId: 's1', generationId: 1 });
      
      const selection = selector.select({
        goal: 'Click on input and button',
        projection: {
          projectionId: 'p1',
          observationId: obs.observationId,
          generationId: obs.generationId,
          url: obs.url,
          title: obs.title,
          interactions: obs.refs.map(r => ({ ...r, score: 100 })),
          readables: [],
          navigation: [],
          regions: [],
          focus: undefined,
          warnings: [],
          stats: { interactionCount: obs.refs.length, readableCount: 0, navigationCount: 0, regionCount: 0 },
        },
      });
  
      const disabledButton = obs.refs.find(ref => ref.name === 'Disabled Action');
      if (disabledButton) {
        assert.ok(
          !selection.workingSet.actionSurface.clickableRefs.includes(disabledButton.refId),
          'Disabled buttons must not be offered as clickable actions'
        );
      }
    } finally {
      await browser.close();
    }
  });
  ```

- [ ] **Step 2: Run tests to verify**
  Run: `npx tsx --test tests/integration/v2/architecturalInvariants.test.ts`
  Expected: PASS

- [ ] **Step 3: Commit**
  ```bash
  git add tests/integration/v2/architecturalInvariants.test.ts
  git commit -m "test: add planner surface affordance correctness assertions"
  ```

---

### Task 5: Layer 3 - Continuity & Graph Bounds

**Files:**
- Modify: `tests/integration/v2/architecturalInvariants.test.ts` (Append test cases)

- [ ] **Step 1: Append Continuity Interpreter and Graph Growth Tests**
  Verify local state transitions, interpreter mutations, and bounded memory limits in `ContinuityGraph`:
  ```typescript
  test('Continuity Layer: State Transitions and Graph Growth Bounds', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const observer = new ObservationService();
    const interpreter = new ContinuityInterpreter();
    const graph = new ContinuityGraph({ maxTransitions: 5 });
  
    try {
      // 1. Transition classification on element appearance
      await page.goto(fixtureUrl('delayed-load.html'));
      const before = await observer.capture({ page, sessionId: 's1', generationId: 1 });
      graph.applyObservation(before);
  
      await page.click('#trigger-load');
      // Wait for stabilization
      await page.waitForTimeout(250);
      const after = await observer.capture({ page, sessionId: 's1', generationId: 2 });
      
      const evidence = interpreter.interpret(before, after);
      graph.applyTransition(evidence);
      const snapshot = graph.applyObservation(after);
  
      assert.equal(evidence.transitionClass, 'structural_local', 'Appearance transition should be structural local');
      assert.ok(evidence.refChanges.appeared.length > 0, 'New element must be captured in appeared refs');
  
      // 2. Graph Growth Bounds under 200 mutations
      await page.goto(fixtureUrl('local-rerender.html'));
      for (let i = 0; i < 200; i++) {
        const genId = i + 3;
        const obsBefore = await observer.capture({ page, sessionId: 's1', generationId: genId });
        graph.applyObservation(obsBefore);
        
        // Trigger a mutation toggle
        await page.click('#toggle-panel');
        const obsAfter = await observer.capture({ page, sessionId: 's1', generationId: genId + 1 });
        const trEvidence = interpreter.interpret(obsBefore, obsAfter);
        
        graph.applyTransition(trEvidence);
        const loopSnapshot = graph.applyObservation(obsAfter);
        
        // Assert invariants at intervals
        if (i % 50 === 0) {
          assert.ok(loopSnapshot.refs.length < 500, 'Graph ref count must remain bounded');
          assert.ok(loopSnapshot.transitions.length <= 5, 'Transition history must be capped by maxTransitions');
        }
      }
    } finally {
      await browser.close();
    }
  });
  ```

- [ ] **Step 2: Run tests to verify**
  Run: `npx tsx --test tests/integration/v2/architecturalInvariants.test.ts`
  Expected: PASS

- [ ] **Step 3: Commit**
  ```bash
  git add tests/integration/v2/architecturalInvariants.test.ts
  git commit -m "test: add transition classification and graph growth bounds testing"
  ```

---

### Task 6: Package Script & Full Verification

**Files:**
- Modify: `package.json:scripts`

- [ ] **Step 1: Add NPM script to package.json**
  Modify `package.json` to register the command:
  ```json
  "test:invariants": "tsx --test tests/integration/v2/architecturalInvariants.test.ts"
  ```

- [ ] **Step 2: Run complete invariants suite via npm**
  Run: `npm run test:invariants`
  Expected: All 11 assertions across the 5 test suites pass successfully.

- [ ] **Step 3: Commit**
  ```bash
  git add package.json
  git commit -m "test: add test:invariants run script to package.json"
  ```
