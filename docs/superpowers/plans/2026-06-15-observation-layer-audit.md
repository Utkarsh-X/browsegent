# Observation Layer Audit & Coverage Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete programmatic testing and audit suite to verify that BrowseGent's observation layer captures browser reality accurately, stably, and completely.

**Architecture:** 
1.  **Local Invariant Tests**: Programmatic verification of coverage, filtering, and shadow roots using Playwright and dynamic `page.setContent()`.
2.  **Real-World Audit Script**: Script-based transitions (State A -> B -> C) on public websites (Wikipedia, Cambridge, Amazon, GitHub, Reddit) to measure semantic extraction, stability, and loss rates.
3.  **Audit Report**: Summarize findings in a structured `OBSERVATION_AUDIT_REPORT.md`.

**Tech Stack:** Node.js, Playwright, TypeScript, tsx, node:test.

---

## Task Map

```
tests/integration/v2/observationAudit.test.ts
  └── Task 1: Layer 1 Local Invariant Verification (Coverage, Filtering, Shadow roots)
scripts/run_observation_audit.ts
  ├── Task 2: Real Website State Transitions & Known Controls Schema
  ├── Task 3: Telemetry Metrics Collection (Loss, Stability, Density, Latency)
  └── Task 4: Observation Audit Report Generator (OBSERVATION_AUDIT_REPORT.md)
package.json
  └── Task 5: Script Registration & Verification
```

---

### Task 1: Local Invariant Integration Tests

**Files:**
- Create: `tests/integration/v2/observationAudit.test.ts`

- [ ] **Step 1: Write local invariant tests**
  Create the test file verifying Coverage, Hidden Element Filtering, Dynamic Paint, Open Shadow DOM, and Nested Open Shadow DOM:
  ```typescript
  import test from 'node:test';
  import assert from 'node:assert/strict';
  import { chromium } from 'playwright';
  import { ObservationService } from '../../../src/v2/substrate/ObservationService';
  import { RefService } from '../../../src/v2/runtime/RefService';
  
  test('Local Invariant: Coverage, Hidden Filtering, and Shadow roots', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const observer = new ObservationService();
    const refService = new RefService();
  
    try {
      // 1. Coverage Invariant
      await page.setContent(`
        <html>
          <body>
            <form>
              <input id="txt" type="text" placeholder="Username" />
              <textarea id="ta" aria-label="Comment"></textarea>
              <button id="btn">Submit</button>
              <a id="lnk" href="/docs">Link</a>
              <input id="cb" type="checkbox" />
              <input id="rb" type="radio" />
              <select id="sel"><option>Opt</option></select>
              <input id="cbx" role="combobox" aria-autocomplete="list" />
            </form>
          </body>
        </html>
      `);
      const raw1 = await observer.capture({ page, sessionId: 's1', generationId: 1 });
      const obs1 = refService.assign(raw1);
      
      const expectedNames = ['Username', 'Comment', 'Submit', 'Link', 'Opt'];
      for (const name of expectedNames) {
        const found = obs1.refs.some(ref => ref.name === name || ref.text === name);
        assert.ok(found, `Expected control "${name}" should be observed`);
      }
  
      // 2. Hidden Element Invariant
      await page.setContent(`
        <html>
          <body>
            <button id="h1" style="display: none;">Hidden 1</button>
            <button id="h2" style="visibility: hidden;">Hidden 2</button>
            <button id="h3" style="opacity: 0;">Hidden 3</button>
            <button id="h4" aria-hidden="true">Hidden 4</button>
          </body>
        </html>
      `);
      const raw2 = await observer.capture({ page, sessionId: 's1', generationId: 1 });
      const obs2 = refService.assign(raw2);
      obs2.refs.forEach(ref => {
        if (ref.name && ref.name.startsWith('Hidden')) {
          assert.equal(ref.visibility, 'hidden', 'Hidden controls should have hidden visibility state');
        }
      });
  
      // 3. Dynamic Paint Invariant
      await page.setContent(`
        <html>
          <body>
            <div id="target"></div>
            <script>
              setTimeout(() => {
                document.getElementById('target').innerHTML = '<button id="late">Late Button</button>';
              }, 100);
            </script>
          </body>
        </html>
      `);
      // Wait for paint to settle
      await page.waitForTimeout(200);
      const raw3 = await observer.capture({ page, sessionId: 's1', generationId: 1 });
      const obs3 = refService.assign(raw3);
      assert.ok(obs3.refs.some(r => r.name === 'Late Button'), 'Dynamic late-bound elements must be captured');
  
      // 4. Open Shadow DOM Invariant
      await page.setContent(`
        <html>
          <body>
            <div id="host"></div>
            <script>
              const host = document.getElementById('host');
              const root = host.attachShadow({ mode: 'open' });
              root.innerHTML = '<button id="sh-btn">Shadow Button</button>';
            </script>
          </body>
        </html>
      `);
      const raw4 = await observer.capture({ page, sessionId: 's1', generationId: 1 });
      const obs4 = refService.assign(raw4);
      assert.ok(obs4.refs.some(r => r.name === 'Shadow Button'), 'Open Shadow DOM button must be observed');
  
      // 5. Nested Open Shadow DOM Invariant
      await page.setContent(`
        <html>
          <body>
            <div id="outer-host"></div>
            <script>
              const outer = document.getElementById('outer-host');
              const outerRoot = outer.attachShadow({ mode: 'open' });
              outerRoot.innerHTML = '<div id="inner-host"></div>';
              const inner = outerRoot.getElementById('inner-host');
              const innerRoot = inner.attachShadow({ mode: 'open' });
              innerRoot.innerHTML = '<button id="nested-btn">Nested Button</button>';
            </script>
          </body>
        </html>
      `);
      const raw5 = await observer.capture({ page, sessionId: 's1', generationId: 1 });
      const obs5 = refService.assign(raw5);
      assert.ok(obs5.refs.some(r => r.name === 'Nested Button'), 'Nested Open Shadow DOM button must be observed');
  
    } finally {
      await browser.close();
    }
  });
  ```

- [ ] **Step 2: Run local test to verify**
  Run: `npx tsx --test tests/integration/v2/observationAudit.test.ts`
  Expected: PASS

- [ ] **Step 3: Commit**
  ```bash
  git add tests/integration/v2/observationAudit.test.ts
  git commit -m "test: add local observation layer invariant tests"
  ```

---

### Task 2: Real Website State Transitions & Known Controls Schema

**Files:**
- Create: `scripts/run_observation_audit.ts`

- [ ] **Step 1: Write baseline framework and site definitions**
  Create the skeleton for `scripts/run_observation_audit.ts` that includes imports, telemetry data structures, and the site configurations for Wikipedia, Cambridge, Amazon, GitHub, and Reddit:
  ```typescript
  import { writeFileSync } from 'node:fs';
  import { resolve } from 'node:path';
  import { chromium, Page } from 'playwright';
  
  import { ObservationService } from '../src/v2/substrate/ObservationService';
  import { RefService } from '../src/v2/runtime/RefService';
  import { PlannerWorkingSetSelector } from '../src/v2/planner/PlannerWorkingSetSelector';
  
  interface KnownControlAudit {
    name: string;
    matcher: (ref: any) => boolean;
  }
  
  interface AuditState {
    stateLabel: string;
    action?: (page: Page) => Promise<void>;
    expectedControls: KnownControlAudit[];
  }
  
  interface SiteConfig {
    name: string;
    url: string;
    critical: boolean;
    states: AuditState[];
  }
  
  interface AuditMetrics {
    totalNodes: number;
    actionableRefs: number;
    lossRate: number;
    duplicateDensity: number;
    actionabilityCoverage: number;
    stabilityVariance: number;
    observationTimeMs: number;
    refGenerationTimeMs: number;
    workingSetTimeMs: number;
    missingControlsList: string[];
  }
  
  const SITE_CONFIGS: SiteConfig[] = [
    {
      name: 'Wikipedia',
      url: 'https://www.wikipedia.org/',
      critical: true,
      states: [
        {
          stateLabel: 'State A (Homepage)',
          expectedControls: [
            { name: 'Search Input', matcher: r => r.tagName === 'input' && r.name === 'Search Wikipedia' },
            { name: 'Language Dropdown', matcher: r => r.tagName === 'select' && r.name === 'Language' },
            { name: 'Search Button', matcher: r => r.tagName === 'button' && r.name === 'Search' }
          ]
        },
        {
          stateLabel: 'State B (Type Search Query)',
          action: async (page) => {
            const input = page.locator('input[name="search"]');
            await input.fill('software engineering');
          },
          expectedControls: [
            { name: 'Search Input', matcher: r => r.tagName === 'input' && r.name === 'Search Wikipedia' }
          ]
        },
        {
          stateLabel: 'State C (Article page)',
          action: async (page) => {
            await page.click('button[type="submit"]');
            await page.waitForTimeout(2000);
          },
          expectedControls: [
            { name: 'Contents list', matcher: r => r.role === 'link' && r.name === 'Contents' }
          ]
        }
      ]
    },
    {
      name: 'Cambridge Dictionary',
      url: 'https://dictionary.cambridge.org/',
      critical: true,
      states: [
        {
          stateLabel: 'State A (Homepage)',
          expectedControls: [
            { name: 'Search Input', matcher: r => r.tagName === 'input' && r.name === 'Search English' },
            { name: 'Search Button', matcher: r => r.tagName === 'button' && r.name === 'Search' }
          ]
        },
        {
          stateLabel: 'State B (Autocomplete Dropdown)',
          action: async (page) => {
            const input = page.locator('input[name="q"]');
            await input.fill('sustainability');
            await page.waitForTimeout(1500); // Let autocomplete paint
          },
          expectedControls: [
            { name: 'Search Input', matcher: r => r.tagName === 'input' && r.name === 'Search English' },
            { name: 'Autocomplete Popup Item', matcher: r => r.name === 'sustainability' }
          ]
        },
        {
          stateLabel: 'State C (Definition Page)',
          action: async (page) => {
            await page.keyboard.press('Enter');
            await page.waitForTimeout(3000);
          },
          expectedControls: [
            { name: 'UK pronunciation speaker', matcher: r => r.name === 'Listen to UK pronunciation' },
            { name: 'US pronunciation speaker', matcher: r => r.name === 'Listen to US pronunciation' }
          ]
        }
      ]
    },
    {
      name: 'Amazon',
      url: 'https://www.amazon.com/',
      critical: true,
      states: [
        {
          stateLabel: 'State A (Homepage)',
          expectedControls: [
            { name: 'Search input', matcher: r => r.tagName === 'input' && r.name === 'Search Amazon' },
            { name: 'Search submit button', matcher: r => r.tagName === 'input' && r.name === 'Go' }
          ]
        },
        {
          stateLabel: 'State B (Type Laptop Query)',
          action: async (page) => {
            const input = page.locator('#twotabsearchtextbox');
            await input.fill('laptop');
          },
          expectedControls: [
            { name: 'Search input', matcher: r => r.tagName === 'input' && r.name === 'Search Amazon' }
          ]
        },
        {
          stateLabel: 'State C (Results Page)',
          action: async (page) => {
            await page.click('#nav-search-submit-button');
            await page.waitForTimeout(3000);
          },
          expectedControls: [
            { name: 'Next page link', matcher: r => r.name === 'Next' && r.role === 'link' }
          ]
        }
      ]
    },
    {
      name: 'GitHub',
      url: 'https://github.com/',
      critical: true,
      states: [
        {
          stateLabel: 'State A (Homepage)',
          expectedControls: [
            { name: 'Sign in link', matcher: r => r.role === 'link' && r.name === 'Sign in' },
            { name: 'Sign up button', matcher: r => r.role === 'link' && r.name === 'Sign up' }
          ]
        },
        {
          stateLabel: 'State B (Navigate Repository)',
          action: async (page) => {
            await page.goto('https://github.com/Utkarsh-X/browsegent');
            await page.waitForTimeout(2000);
          },
          expectedControls: [
            { name: 'Code tab link', matcher: r => r.role === 'link' && r.name === 'Code' },
            { name: 'Issues tab link', matcher: r => r.role === 'link' && r.name === 'Issues' }
          ]
        },
        {
          stateLabel: 'State C (Issues page)',
          action: async (page) => {
            await page.click('a[data-tab-item="issues-tab"]');
            await page.waitForTimeout(2000);
          },
          expectedControls: [
            { name: 'Search issues input', matcher: r => r.tagName === 'input' && r.name === 'Search all issues' },
            { name: 'Filters dropdown button', matcher: r => r.role === 'button' && r.name === 'Filters' }
          ]
        }
      ]
    },
    {
      name: 'Reddit',
      url: 'https://www.reddit.com/',
      critical: false, // Exploratory only
      states: [
        {
          stateLabel: 'State A (Homepage)',
          expectedControls: [
            { name: 'Search input', matcher: r => r.tagName === 'input' && r.name === 'Search Reddit' }
          ]
        },
        {
          stateLabel: 'State B (Subreddit page)',
          action: async (page) => {
            await page.goto('https://www.reddit.com/r/javascript/');
            await page.waitForTimeout(3000);
          },
          expectedControls: [
            { name: 'Join subreddit button', matcher: r => r.role === 'button' && r.name === 'Join' }
          ]
        },
        {
          stateLabel: 'State C (Post page)',
          action: async (page) => {
            const post = page.locator('a[data-click-id="body"]').first();
            await post.click().catch(() => page.goto(page.url()));
            await page.waitForTimeout(3000);
          },
          expectedControls: [
            { name: 'Upvote button', matcher: r => r.role === 'button' && r.name === 'Upvote' }
          ]
        }
      ]
    }
  ];
  ```

- [ ] **Step 2: Commit**
  ```bash
  git add scripts/run_observation_audit.ts
  git commit -m "test: add real website configuration mapping schema for observation layer audit"
  ```

---

### Task 3: Telemetry Metrics Collection (Loss, Stability, Density, Latency)

**Files:**
- Modify: `scripts/run_observation_audit.ts` (Append metrics collection and stabilization helpers)

- [ ] **Step 1: Append telemetry helpers**
  Write the core metrics engine that calculates Loss, Stability, Duplicate Density, Actionability Coverage, and Segmented Latency:
  ```typescript
  async function computeStability(
    page: Page,
    observer: ObservationService,
    refService: RefService
  ): Promise<number> {
    const counts: number[] = [];
    const idSets: Set<string>[] = [];
    
    for (let i = 0; i < 5; i++) {
      const start = Date.now();
      const raw = await observer.capture({ page, sessionId: 'stability', generationId: 99 });
      const obs = refService.assign(raw);
      counts.push(obs.refs.length);
      idSets.push(new Set(obs.refs.map(r => r.refId)));
      await page.waitForTimeout(50);
    }
    
    // Calculate variance of ref count
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    const sqDiff = counts.map(v => Math.pow(v - avg, 2));
    const variance = sqDiff.reduce((a, b) => a + b, 0) / sqDiff.length;
    return variance;
  }
  
  function calculateDuplicateDensity(refs: any[]): number {
    if (refs.length === 0) return 0;
    const nameCounts = new Map<string, number>();
    refs.forEach(r => {
      const key = `${r.role}|${r.name ?? ''}|${r.text ?? ''}`;
      nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
    });
    let duplicates = 0;
    for (const [_, count] of nameCounts) {
      if (count > 1) duplicates += count;
    }
    return duplicates / refs.length;
  }
  
  async function auditState(
    page: Page,
    state: AuditState,
    observer: ObservationService,
    refService: RefService,
    selector: PlannerWorkingSetSelector
  ): Promise<AuditMetrics> {
    // 1. Trigger action
    if (state.action) {
      await state.action(page);
    }
  
    // 2. Measure Segmented Latencies
    const t0 = Date.now();
    const rawObs = await observer.capture({ page, sessionId: 'audit', generationId: 1 });
    const t1 = Date.now();
    const obs = refService.assign(rawObs);
    const t2 = Date.now();
    
    const projection = {
      projectionId: 'proj_audit',
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
        kind: 'generic' as any,
      })),
      readables: [],
      navigation: [],
      regions: [],
      warnings: [],
      stats: { interactionCount: obs.refs.length, readableCount: 0, navigationCount: 0, regionCount: 0 },
    };
    
    const selection = selector.select({
      goal: 'Audit observation coverage',
      projection,
    });
    const t3 = Date.now();
  
    // 3. Compute Stability (takes 5 extra consecutive captures)
    const stabilityVariance = await computeStability(page, observer, refService);
  
    // 4. Calculate Coverage & Loss
    const missingControlsList: string[] = [];
    let foundCount = 0;
    for (const expected of state.expectedControls) {
      const found = obs.refs.some(expected.matcher);
      if (found) {
        foundCount++;
      } else {
        missingControlsList.push(expected.name);
      }
    }
    const lossRate = state.expectedControls.length > 0 
      ? 1 - (foundCount / state.expectedControls.length)
      : 0;
  
    const surface = selection.workingSet.actionSurface;
    const actionableCount = surface.clickableRefs.length + surface.typeableRefs.length + surface.selectableRefs.length;
  
    return {
      totalNodes: obs.refs.length,
      actionableRefs: actionableCount,
      lossRate,
      duplicateDensity: calculateDuplicateDensity(obs.refs),
      actionabilityCoverage: obs.refs.length > 0 ? actionableCount / obs.refs.length : 0,
      stabilityVariance,
      observationTimeMs: t1 - t0,
      refGenerationTimeMs: t2 - t1,
      workingSetTimeMs: t3 - t2,
      missingControlsList
    };
  }
  ```

- [ ] **Step 2: Commit**
  ```bash
  git add scripts/run_observation_audit.ts
  git commit -m "test: implement observation telemetry and segmented latency helpers"
  ```

---

### Task 4: Observation Audit Report Generator

**Files:**
- Modify: `scripts/run_observation_audit.ts` (Append report writing and main execution loop)

- [ ] **Step 1: Write main loop and Markdown builder**
  Append the CLI entry point, execution runner, and Markdown formatting builder to the script:
  ```typescript
  async function run() {
    console.log('Starting State-Transition Observation Audit...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();
  
    const observer = new ObservationService();
    const refService = new RefService();
    const selector = new PlannerWorkingSetSelector();
  
    let markdown = `# Observation Layer Audit & Coverage Report\n\n`;
    markdown += `Generated on: ${new Date().toISOString()}\n\n`;
  
    for (const config of SITE_CONFIGS) {
      console.log(`Auditing Site: ${config.name}`);
      markdown += `## Site: ${config.name} (${config.critical ? 'Critical' : 'Exploratory'})\n\n`;
      markdown += `| State | Total Refs | Actionable Refs | Loss Rate | Duplicate Density | Actionability Coverage | Stability Var | Obs Time | Ref Gen Time | WS Time | Missing Controls |\n`;
      markdown += `| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |\n`;
  
      try {
        await page.goto(config.url);
        await page.waitForTimeout(3000); // Settle
        
        for (const state of config.states) {
          console.log(`  - Running ${state.stateLabel}`);
          const metrics = await auditState(page, state, observer, refService, selector);
          
          markdown += `| ${state.stateLabel} | ${metrics.totalNodes} | ${metrics.actionableRefs} | ${(metrics.lossRate * 100).toFixed(1)}% | ${(metrics.duplicateDensity * 100).toFixed(1)}% | ${(metrics.actionabilityCoverage * 100).toFixed(1)}% | ${metrics.stabilityVariance.toFixed(2)} | ${metrics.observationTimeMs}ms | ${metrics.refGenerationTimeMs}ms | ${metrics.workingSetTimeMs}ms | ${metrics.missingControlsList.join(', ') || 'None'} |\n`;
        }
      } catch (err: any) {
        console.error(`Error auditing ${config.name}:`, err.message);
        markdown += `| ERROR | - | - | - | - | - | - | - | - | - | ${err.message} |\n`;
      }
      markdown += `\n`;
    }
  
    await browser.close();
  
    const dest = resolve(__dirname, '../docs/superpowers/specs/OBSERVATION_AUDIT_REPORT.md');
    writeFileSync(dest, markdown, 'utf8');
    console.log(`Audit complete! Report written to ${dest}`);
  }
  
  run().catch(console.error);
  ```

- [ ] **Step 2: Commit**
  ```bash
  git add scripts/run_observation_audit.ts
  git commit -m "test: finalize run_observation_audit.ts main loop and markdown builder"
  ```

---

### Task 5: Script Registration & Verification

**Files:**
- Modify: `package.json:scripts`

- [ ] **Step 1: Register NPM Script**
  Add the command to `package.json`:
  ```json
  "audit:observation": "tsx scripts/run_observation_audit.ts"
  ```

- [ ] **Step 2: Run the local invariants tests**
  Run: `npx tsx --test tests/integration/v2/observationAudit.test.ts`
  Expected: PASS

- [ ] **Step 3: Run the real website audit script**
  Run: `npm run audit:observation`
  Expected: Script completes successfully and generates `docs/superpowers/specs/OBSERVATION_AUDIT_REPORT.md`.

- [ ] **Step 4: Commit**
  ```bash
  git add package.json
  git commit -m "test: register npm script for observation layer audit"
  ```
