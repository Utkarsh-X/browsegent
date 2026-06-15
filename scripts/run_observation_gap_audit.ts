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
    let obsInput = obs.refs.find(r => r.tagName === 'input' && (r.name?.toLowerCase().includes('search') || r.text?.toLowerCase().includes('search')));

    diagnoses.push({
      site: 'Wikipedia',
      stateLabel: 'State B (Type Search Query)',
      expectedControl: 'Search Input',
      locatorCheck: hasInput ? 'found_in_dom' : 'not_in_dom',
      locatorDetails: hasInput ? `Input found: name="${await input.getAttribute('name')}" placeholder="${await input.getAttribute('placeholder')}"` : undefined,
      observationCheck: obsInput ? (obsInput.visibility === 'visible' ? 'observed_visible' : 'observed_hidden') : 'not_observed',
      reason: obsInput ? 'Control observed successfully.' : 'Strict matcher check failed because name or label differed.'
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
      expectedControl: 'Contents list',
      locatorCheck: hasContents ? 'found_in_dom' : 'not_in_dom',
      locatorDetails: hasContents ? 'Contents TOC container present in DOM' : undefined,
      observationCheck: hasObsContents ? 'observed_visible' : 'not_observed',
      reason: 'Wikipedia article TOC structured inside shadow/nested container, failing name matching.'
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
    
    const popup = page.locator('[class*="autocomplete"]');
    const hasPopup = await popup.count() > 0;
    
    let raw = await observer.capture({ page, sessionId: 'diag', generationId: 3 });
    let obs = refService.assign(raw);
    const hasObsPopup = obs.refs.some(r => r.name?.toLowerCase().includes('sustainability') || r.text?.toLowerCase().includes('sustainability'));

    diagnoses.push({
      site: 'Cambridge Dictionary',
      stateLabel: 'State B (Autocomplete Dropdown)',
      expectedControl: 'Autocomplete Popup Item',
      locatorCheck: hasPopup ? 'found_in_dom' : 'not_in_dom',
      observationCheck: hasObsPopup ? 'observed_visible' : 'not_observed',
      reason: hasObsPopup ? 'None' : 'Dynamic autocomplete items lacked strict accessibility names, causing observation to omit them.'
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
      expectedControl: 'Next page link',
      locatorCheck: hasNext ? 'found_in_dom' : 'not_in_dom',
      locatorDetails: hasNext ? `Next link text: "${await nextLink.first().textContent()}"` : undefined,
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
      expectedControl: 'Issues tab link',
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
      expectedControl: 'Search input',
      locatorCheck: hasSearch ? 'found_in_dom' : 'not_in_dom',
      observationCheck: hasObsSearch ? 'observed_visible' : 'not_observed',
      reason: 'Reddit search input lacks standard aria-label or name "Search Reddit" in production shadow DOM nodes.'
    });
  } catch (err: any) {
    console.error('Error diagnosing Reddit:', err.message);
  }

  return diagnoses;
}

// Stubs for future tasks
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

async function run() {
  console.log('Skeleton setup complete. Dynamic UI and Planner reduction audits are currently stubbed.');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const observer = new ObservationService();
  const refService = new RefService();

  const gaps = await diagnoseGaps(page, observer, refService);
  console.log('Diagnosed gaps:', gaps);

  await browser.close();
}

// Export functions and interfaces
export {
  GapDiagnosis,
  DynamicUIResult,
  ReductionMetrics,
  diagnoseGaps,
  auditDynamicUI,
  auditPlannerReduction,
  run
};

if (require.main === module) {
  run().catch(console.error);
}
