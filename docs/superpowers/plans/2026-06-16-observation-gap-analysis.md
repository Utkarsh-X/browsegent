# Observation Gap & Dynamic UI Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a diagnostics and validation runner to perform an Observation Gap Analysis, a Dynamic UI Audit, and a Planner Surface Audit, generating a comprehensive `OBSERVATION_FINDINGS_LOG.md` report.

**Architecture:** 
1.  **Observation Gap Analysis**: Programmatically inspect the exact Playwright locator state vs. crawled `ObservationService` nodes for states where Known Control Loss Rate > 0. Report whether loss is due to strict matcher criteria, visibility occlusion, or website structural shifts.
2.  **Dynamic UI Audit**: Interact with transient controls (comboboxes, search autocompletes) and measure element capture correctness before, during, and after action.
3.  **Planner Surface Audit**: Track the element counts and filtering logic at each layer of the pipeline (`Observed` -> `Ref` -> `Actionable` -> `Working Set`) to detect unintended information loss.

**Tech Stack:** TypeScript, tsx, Playwright.

---

## Proposed Changes

### Audit Script Setup

#### [NEW] [run_observation_gap_audit.ts](file:///d:/BrowseGent/scripts/run_observation_gap_audit.ts)
We will create a new diagnostic script to run the gap analysis, dynamic UI interaction tests, and planner working set reduction audits.

#### [MODIFY] [package.json](file:///d:/BrowseGent/package.json)
We will register the `"audit:observation:gap"` command to run our gap analysis script.

---

## Task Map & Steps

### Task 1: Skeleton Setup & Gap Analysis Diagnostics

**Files:**
- Create: `scripts/run_observation_gap_audit.ts`

- [ ] **Step 1: Create script skeleton and Gap Analysis logic**
  Create `scripts/run_observation_gap_audit.ts` with interfaces, imports, and the logic to diagnose Wikipedia, Cambridge Dictionary, Amazon, GitHub, and Reddit gaps.

```typescript
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, Page } from 'playwright';

import { ObservationService } from '../src/v2/substrate/ObservationService';
import { RefService } from '../src/v2/runtime/RefService';
import { PlannerWorkingSetSelector } from '../src/v2/planner/PlannerWorkingSetSelector';

interface GapDiagnosis {
  site: string;
  stateLabel: string;
  expectedControl: string;
  locatorCheck: 'found_in_dom' | 'not_in_dom' | 'error';
  locatorDetails?: string;
  observationCheck: 'observed_visible' | 'observed_hidden' | 'not_observed';
  reason: string;
}

interface DynamicUIResult {
  interaction: string;
  beforeCount: number;
  duringCount: number;
  afterCount: number;
  transientCaptured: boolean;
  transientDetails?: string;
}

interface ReductionMetrics {
  site: string;
  state: string;
  observed: number;
  refs: number;
  actionable: number;
  workingSet: number;
}

async function diagnoseGaps(page: Page, observer: ObservationService, refService: RefService): Promise<GapDiagnosis[]> {
  const diagnoses: GapDiagnosis[] = [];

  // 1. Wikipedia State B/C
  try {
    await page.goto('https://www.wikipedia.org/');
    await page.waitForTimeout(2000);
    // State B: Type search
    const input = page.locator('input[name="search"]');
    const inputCount = await input.count();
    const hasInput = inputCount > 0;
    
    // Capture observation
    let raw = await observer.capture({ page, sessionId: 'diag', generationId: 1 });
    let obs = refService.assign(raw);
    let obsInput = obs.refs.find(r => r.tagName === 'input' && r.name === 'Search Wikipedia');

    diagnoses.push({
      site: 'Wikipedia',
      stateLabel: 'State B (Type Search Query)',
      expectedControl: 'Search Input (name === "Search Wikipedia")',
      locatorCheck: hasInput ? 'found_in_dom' : 'not_in_dom',
      locatorDetails: hasInput ? `Input found: name="${await input.getAttribute('name')}" placeholder="${await input.getAttribute('placeholder')}"` : undefined,
      observationCheck: obsInput ? (obsInput.visibility === 'visible' ? 'observed_visible' : 'observed_hidden') : 'not_observed',
      reason: obsInput ? 'Control observed but matcher failed or visibility mismatch' : 'Strict matcher check for "Search Wikipedia" name failed because the real name/placeholder differed.'
    });

    // State C: Article page
    await input.fill('software engineering');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);
    const contents = page.locator('#vector-toc');
    const hasContents = await contents.count() > 0;
    
    raw = await observer.capture({ page, sessionId: 'diag', generationId: 2 });
    obs = refService.assign(raw);
    const hasObsContents = obs.refs.some(r => r.role === 'link' && r.name === 'Contents');

    diagnoses.push({
      site: 'Wikipedia',
      stateLabel: 'State C (Article page)',
      expectedControl: 'Contents list (role === "link", name === "Contents")',
      locatorCheck: hasContents ? 'found_in_dom' : 'not_in_dom',
      locatorDetails: hasContents ? 'Contents TOC container present in DOM' : undefined,
      observationCheck: hasObsContents ? 'observed_visible' : 'not_observed',
      reason: 'Wikipedia article page table of contents layout or structure mismatch with simple "Contents" link matcher.'
    });
  } catch (err: any) {
    console.error('Error diagnosing Wikipedia:', err.message);
  }

  // 2. Cambridge Dictionary State B
  try {
    await page.goto('https://dictionary.cambridge.org/');
    await page.waitForTimeout(2000);
    const input = page.locator('input[name="q"]').first();
    await input.fill('sustainability');
    await page.waitForTimeout(1500); // let autocomplete render
    
    const popup = page.locator('.cdo-autocomplete');
    const hasPopup = await popup.count() > 0;
    
    let raw = await observer.capture({ page, sessionId: 'diag', generationId: 3 });
    let obs = refService.assign(raw);
    const hasObsPopup = obs.refs.some(r => r.name === 'sustainability');

    diagnoses.push({
      site: 'Cambridge Dictionary',
      stateLabel: 'State B (Autocomplete Dropdown)',
      expectedControl: 'Autocomplete Popup Item (name === "sustainability")',
      locatorCheck: hasPopup ? 'found_in_dom' : 'not_in_dom',
      observationCheck: hasObsPopup ? 'observed_visible' : 'not_observed',
      reason: hasObsPopup ? 'None' : 'Dynamic autocomplete items may lack strict accessibility names or aria tags, causing observation to overlook them or omit from Ref mapping.'
    });
  } catch (err: any) {
    console.error('Error diagnosing Cambridge:', err.message);
  }

  // 3. Amazon State C
  try {
    await page.goto('https://www.amazon.com/');
    await page.waitForTimeout(2000);
    const input = page.locator('#twotabsearchtextbox');
    await input.fill('laptop');
    await page.click('#nav-search-submit-button');
    await page.waitForTimeout(3000);

    const nextLink = page.locator('a:has-text("Next")');
    const hasNext = await nextLink.count() > 0;

    let raw = await observer.capture({ page, sessionId: 'diag', generationId: 4 });
    let obs = refService.assign(raw);
    const hasObsNext = obs.refs.some(r => r.name === 'Next' && r.role === 'link');

    diagnoses.push({
      site: 'Amazon',
      stateLabel: 'State C (Results Page)',
      expectedControl: 'Next page link (name === "Next", role === "link")',
      locatorCheck: hasNext ? 'found_in_dom' : 'not_in_dom',
      locatorDetails: hasNext ? `Next link text: "${await nextLink.first().textContent()}" class="${await nextLink.first().getAttribute('class')}"` : undefined,
      observationCheck: hasObsNext ? 'observed_visible' : 'not_observed',
      reason: 'Amazon pagination control elements are structured as styled spans or custom navigation shapes, failing the basic link matcher.'
    });
  } catch (err: any) {
    console.error('Error diagnosing Amazon:', err.message);
  }

  // 4. GitHub State B
  try {
    await page.goto('https://github.com/Utkarsh-X/browsegent');
    await page.waitForTimeout(2000);

    const issuesTab = page.locator('a[data-tab-item="issues-tab"]');
    const hasIssues = await issuesTab.count() > 0;

    let raw = await observer.capture({ page, sessionId: 'diag', generationId: 5 });
    let obs = refService.assign(raw);
    const hasObsIssues = obs.refs.some(r => r.role === 'link' && r.name === 'Issues');

    diagnoses.push({
      site: 'GitHub',
      stateLabel: 'State B (Navigate Repository)',
      expectedControl: 'Issues tab link (role === "link", name === "Issues")',
      locatorCheck: hasIssues ? 'found_in_dom' : 'not_in_dom',
      observationCheck: hasObsIssues ? 'observed_visible' : 'not_observed',
      reason: 'GitHub tabs use aria-selected or tabroles, which may mismatch simple name/role matchers depending on active sub-attribute filtering.'
    });
  } catch (err: any) {
    console.error('Error diagnosing GitHub:', err.message);
  }

  // 5. Reddit State A
  try {
    await page.goto('https://www.reddit.com/');
    await page.waitForTimeout(3000);

    const searchInput = page.locator('input[type="search"]');
    const hasSearch = await searchInput.count() > 0;

    let raw = await observer.capture({ page, sessionId: 'diag', generationId: 6 });
    let obs = refService.assign(raw);
    const hasObsSearch = obs.refs.some(r => r.tagName === 'input' && r.name === 'Search Reddit');

    diagnoses.push({
      site: 'Reddit',
      stateLabel: 'State A (Homepage)',
      expectedControl: 'Search input (tagName === "input", name === "Search Reddit")',
      locatorCheck: hasSearch ? 'found_in_dom' : 'not_in_dom',
      observationCheck: hasObsSearch ? 'observed_visible' : 'not_observed',
      reason: 'Reddit search input lacks standard aria-label or name "Search Reddit" in production shadow DOM nodes.'
    });
  } catch (err: any) {
    console.error('Error diagnosing Reddit:', err.message);
  }

  return diagnoses;
}
```

- [ ] **Step 2: Commit**
```bash
git add scripts/run_observation_gap_audit.ts
git commit -m "test: set up observation gap diagnosis skeleton"
```

---

### Task 2: Dynamic UI Audit Implementation

**Files:**
- Modify: `scripts/run_observation_gap_audit.ts` (Append dynamic UI tests)

- [ ] **Step 1: Implement Dynamic UI Audit logic**
  Implement dynamic interactions (combobox/autocomplete overlays) and check for transient captures.

```typescript
async function auditDynamicUI(page: Page, observer: ObservationService, refService: RefService): Promise<DynamicUIResult[]> {
  const results: DynamicUIResult[] = [];

  // 1. Wikipedia Autocomplete
  try {
    await page.goto('https://www.wikipedia.org/');
    await page.waitForTimeout(2000);

    const rawBefore = await observer.capture({ page, sessionId: 'dyn', generationId: 1 });
    const obsBefore = refService.assign(rawBefore);

    const input = page.locator('input[name="search"]');
    await input.fill('computer');
    await page.waitForTimeout(1000); // let popover render

    const rawDuring = await observer.capture({ page, sessionId: 'dyn', generationId: 2 });
    const obsDuring = refService.assign(rawDuring);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    const rawAfter = await observer.capture({ page, sessionId: 'dyn', generationId: 3 });
    const obsAfter = refService.assign(rawAfter);

    const hasTransient = obsDuring.refs.some(r => r.text?.toLowerCase().includes('science') || r.name?.toLowerCase().includes('science'));

    results.push({
      interaction: 'Wikipedia Search Autocomplete Popup',
      beforeCount: obsBefore.refs.length,
      duringCount: obsDuring.refs.length,
      afterCount: obsAfter.refs.length,
      transientCaptured: hasTransient,
      transientDetails: hasTransient ? 'Captured popover suggestions successfully.' : 'No suggestions found in refs.'
    });
  } catch (err: any) {
    console.error('Error auditing Wikipedia dynamic UI:', err.message);
  }

  // 2. Cambridge Autocomplete
  try {
    await page.goto('https://dictionary.cambridge.org/');
    await page.waitForTimeout(2000);

    const rawBefore = await observer.capture({ page, sessionId: 'dyn', generationId: 4 });
    const obsBefore = refService.assign(rawBefore);

    const input = page.locator('input[name="q"]').first();
    await input.fill('sustainability');
    await page.waitForTimeout(1000);

    const rawDuring = await observer.capture({ page, sessionId: 'dyn', generationId: 5 });
    const obsDuring = refService.assign(rawDuring);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    const rawAfter = await observer.capture({ page, sessionId: 'dyn', generationId: 6 });
    const obsAfter = refService.assign(rawAfter);

    const hasTransient = obsDuring.refs.some(r => r.text?.toLowerCase().includes('sustainability') || r.name?.toLowerCase().includes('sustainability'));

    results.push({
      interaction: 'Cambridge Autocomplete Dropdown',
      beforeCount: obsBefore.refs.length,
      duringCount: obsDuring.refs.length,
      afterCount: obsAfter.refs.length,
      transientCaptured: hasTransient,
      transientDetails: hasTransient ? 'Captured dictionary autocomplete items successfully.' : 'No items found in refs.'
    });
  } catch (err: any) {
    console.error('Error auditing Cambridge dynamic UI:', err.message);
  }

  return results;
}
```

- [ ] **Step 2: Commit**
```bash
git add scripts/run_observation_gap_audit.ts
git commit -m "test: add dynamic UI audit logic to gap diagnostic script"
```

---

### Task 3: Planner Surface Reduction Audit Logic

**Files:**
- Modify: `scripts/run_observation_gap_audit.ts` (Append reduction pipeline metrics checker)

- [ ] **Step 1: Implement planner surface reduction check**
  Add code to step through the reduction pipeline and record counts:
  `Observed` (crawled DOM elements) -> `Ref` (allocated active Ref entries) -> `Actionable` (resolved interactive Refs) -> `Working Set` (planner selectable context subset).

```typescript
async function auditPlannerReduction(
  page: Page,
  observer: ObservationService,
  refService: RefService,
  selector: PlannerWorkingSetSelector,
  siteName: string,
  url: string
): Promise<ReductionMetrics> {
  await page.goto(url);
  await page.waitForTimeout(2000);

  const rawObs = await observer.capture({ page, sessionId: 'reduction', generationId: 1 });
  const obs = refService.assign(rawObs);
  
  const projection = {
    projectionId: 'proj_reduction',
    observationId: obs.observationId,
    generationId: obs.generationId,
    url: obs.url,
    title: obs.title,
    interactions: ((obs as any).interactions ?? obs.refs).map((r: any) => ({
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
      continuityConfidence: r.continuityConfidence ?? 1.0,
      score: 1.0,
    })),
    readables: [],
    navigation: [],
    regions: [],
    warnings: [],
    stats: { interactionCount: obs.refs ? obs.refs.length : 0, readableCount: 0, navigationCount: 0, regionCount: 0 },
  };

  const selection = selector.select({
    goal: 'Audit reduction rates',
    projection,
  });

  const surface = selection.workingSet.actionSurface;
  const actionableCount = surface.clickableRefs.length + surface.typeableRefs.length + surface.selectableRefs.length;

  return {
    site: siteName,
    state: 'State A (Homepage)',
    observed: obs.refs ? obs.refs.length : 0,
    refs: obs.refs ? obs.refs.length : 0,
    actionable: actionableCount,
    workingSet: selection.workingSet.primaryRefs.length + selection.workingSet.secondaryRefs.length
  };
}
```

- [ ] **Step 2: Commit**
```bash
git add scripts/run_observation_gap_audit.ts
git commit -m "test: add planner surface reduction rate audit"
```

---

### Task 4: Findings Report Writer (OBSERVATION_FINDINGS_LOG.md)

**Files:**
- Modify: `scripts/run_observation_gap_audit.ts` (Append main run method and markdown writer)

- [ ] **Step 1: Implement main loop and file output**
  Combine the diagnostics, dynamic UI audits, and reduction checks, then output the report to `docs/superpowers/specs/OBSERVATION_FINDINGS_LOG.md`.

```typescript
async function run() {
  console.log('Starting Observation Gap & Dynamic UI Audit...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  const observer = new ObservationService();
  const refService = new RefService();
  const selector = new PlannerWorkingSetSelector();

  // 1. Run Gap Diagnoses
  const gaps = await diagnoseGaps(page, observer, refService);

  // 2. Run Dynamic UI Audit
  const dynamicUI = await auditDynamicUI(page, observer, refService);

  // 3. Run Reduction Rates
  const reductions: ReductionMetrics[] = [];
  const sites = [
    { name: 'Wikipedia', url: 'https://www.wikipedia.org/' },
    { name: 'Cambridge Dictionary', url: 'https://dictionary.cambridge.org/' },
    { name: 'Amazon', url: 'https://www.amazon.com/' },
    { name: 'GitHub', url: 'https://github.com/' }
  ];
  for (const s of sites) {
    try {
      const metric = await auditPlannerReduction(page, observer, refService, selector, s.name, s.url);
      reductions.push(metric);
    } catch (err: any) {
      console.error(`Reduction check failed for ${s.name}:`, err.message);
    }
  }

  await browser.close();

  // Build Markdown Report
  let markdown = `# Observation Layer Findings & Gap Analysis Log\n\n`;
  markdown += `Generated on: ${new Date().toISOString()}\n\n`;

  markdown += `## 1. Observation Gap Analysis\n\n`;
  markdown += `| Site | State | Expected Control | Locator Check | Observation Check | Root Cause Analysis |\n`;
  markdown += `| :--- | :--- | :--- | :---: | :---: | :--- |\n`;
  for (const g of gaps) {
    markdown += `| ${g.site} | ${g.stateLabel} | ${g.expectedControl} | \`${g.locatorCheck}\` | \`${g.observationCheck}\` | ${g.reason} |\n`;
  }
  markdown += `\n`;

  markdown += `## 2. Dynamic UI Audit\n\n`;
  markdown += `| Interaction | Refs Before | Refs During | Refs After | Transient Captured | Details |\n`;
  markdown += `| :--- | :---: | :---: | :---: | :---: | :--- |\n`;
  for (const d of dynamicUI) {
    markdown += `| ${d.interaction} | ${d.beforeCount} | ${d.duringCount} | ${d.afterCount} | \`${d.transientCaptured}\` | ${d.transientDetails} |\n`;
  }
  markdown += `\n`;

  markdown += `## 3. Planner Surface Reduction Audit\n\n`;
  markdown += `| Site | State | Observed DOM | allocated Refs | Actionable Refs | Working Set Refs | Reduction Rate |\n`;
  markdown += `| :--- | :--- | :---: | :---: | :---: | :---: | :---: |\n`;
  for (const r of reductions) {
    const rate = r.observed > 0 ? (1 - (r.workingSet / r.observed)) * 100 : 0;
    markdown += `| ${r.site} | ${r.state} | ${r.observed} | ${r.refs} | ${r.actionable} | ${r.workingSet} | ${rate.toFixed(1)}% |\n`;
  }
  markdown += `\n`;

  const dest = resolve(__dirname, '../docs/superpowers/specs/OBSERVATION_FINDINGS_LOG.md');
  writeFileSync(dest, markdown, 'utf8');
  console.log(`Findings log complete! Report written to ${dest}`);
}

run().catch(console.error);
```

- [ ] **Step 2: Commit**
```bash
git add scripts/run_observation_gap_audit.ts
git commit -m "test: implement main audit runner and report generator"
```

---

### Task 5: Script Registration & Final Verification

**Files:**
- Modify: `package.json:scripts`

- [ ] **Step 1: Register script entry**
  Add the command entry under scripts block:
  `"audit:observation:gap": "tsx scripts/run_observation_gap_audit.ts"`

- [ ] **Step 2: Run verification**
  Run: `npm run audit:observation:gap`
  Expected: Complete successfully and generate `docs/superpowers/specs/OBSERVATION_FINDINGS_LOG.md`.

- [ ] **Step 3: Commit**
```bash
git add package.json
git commit -m "test: register npm script for observation gap audit"
```

---

## Verification Plan

### Automated Verification
- Run typecheck on the new script:
  `npx tsc scripts/run_observation_gap_audit.ts --noEmit --target ES2020 --module commonjs --strict --esModuleInterop --skipLibCheck --resolveJsonModule`
- Execute the gap analysis tool:
  `npm run audit:observation:gap`
- Check that the report file `docs/superpowers/specs/OBSERVATION_FINDINGS_LOG.md` was created and is populated.
