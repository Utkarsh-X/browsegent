import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, Page } from 'playwright';

import { ObservationService } from '../src/v2/substrate/ObservationService';
import { RefService } from '../src/v2/runtime/RefService';
import { PlannerWorkingSetSelector } from '../src/v2/planner/PlannerWorkingSetSelector';

interface SurfaceAuditResult {
  surfaceName: string;
  inPlaywrightDom: boolean;
  crawledRawCount: number;
  refGeneratedCount: number;
  detectedTargets: string[];
  details: string;
}

interface LineageTrace {
  controlName: string;
  observed: boolean;
  refGenerated: boolean;
  refId?: string;
  actionable: boolean;
  actionableStatus?: string;
  workingSet: boolean;
  wsReason?: string;
}

async function auditDynamicSurfaces(
  page: Page,
  observer: ObservationService,
  refService: RefService
): Promise<SurfaceAuditResult[]> {
  const results: SurfaceAuditResult[] = [];

  // 1. Wikipedia Autocomplete
  try {
    await page.goto('https://www.wikipedia.org/');
    await page.waitForTimeout(2000);
    const input = page.locator('input[name="search"]');
    await input.fill('computer');
    await page.waitForTimeout(1000);

    const popover = page.locator('.suggestions-dropdown, .cdx-typeahead-search__menu');
    const inDom = await popover.count() > 0;

    const raw: any = await observer.capture({ page, sessionId: 'surface_dyn', generationId: 1 });
    raw.nodes = raw.refs.map((r: any) => {
      const attributes: Record<string, string> = {};
      let id: string | undefined = undefined;
      for (const selector of r.selectorCandidates || []) {
        if (selector.startsWith('#')) {
          id = selector.slice(1);
        } else {
          const match = selector.match(/\[([^=]+)="([^"]+)"\]/);
          if (match) {
            attributes[match[1]] = match[2];
          }
        }
      }
      return {
        tagName: r.tagName,
        id,
        name: r.name,
        attributes,
        text: r.text,
      };
    });

    const obs = refService.assign(raw);
    const suggestions = obs.refs.filter(r => r.text?.toLowerCase().includes('science') || r.name?.toLowerCase().includes('science'));

    results.push({
      surfaceName: 'Wikipedia Search Autocomplete Suggestions',
      inPlaywrightDom: inDom,
      crawledRawCount: raw.nodes.length,
      refGeneratedCount: obs.refs.length,
      detectedTargets: suggestions.map(s => `${s.tagName} [Ref: ${s.refId}]: "${s.text ?? s.name}"`),
      details: suggestions.length > 0 ? 'Dynamic search suggestions successfully observed.' : 'Suggestions missing from crawled observations.'
    });
  } catch (err: any) {
    console.error('Error auditing Wikipedia dynamic surface:', err.message);
  }

  // 2. Cambridge Autocomplete
  try {
    await page.goto('https://dictionary.cambridge.org/');
    await page.waitForTimeout(2000);
    const input = page.locator('input[name="q"]').first();
    await input.fill('sustainability');
    await page.waitForTimeout(1000);

    const popover = page.locator('[class*="autocomplete"]');
    const inDom = await popover.count() > 0;

    const raw: any = await observer.capture({ page, sessionId: 'surface_dyn', generationId: 2 });
    raw.nodes = raw.refs.map((r: any) => {
      const attributes: Record<string, string> = {};
      let id: string | undefined = undefined;
      for (const selector of r.selectorCandidates || []) {
        if (selector.startsWith('#')) {
          id = selector.slice(1);
        } else {
          const match = selector.match(/\[([^=]+)="([^"]+)"\]/);
          if (match) {
            attributes[match[1]] = match[2];
          }
        }
      }
      return {
        tagName: r.tagName,
        id,
        name: r.name,
        attributes,
        text: r.text,
      };
    });

    const obs = refService.assign(raw);
    const suggestions = obs.refs.filter(r => r.text?.toLowerCase().includes('sustainability') || r.name?.toLowerCase().includes('sustainability'));

    results.push({
      surfaceName: 'Cambridge Dictionary Search Autocomplete Dropdown',
      inPlaywrightDom: inDom,
      crawledRawCount: raw.nodes.length,
      refGeneratedCount: obs.refs.length,
      detectedTargets: suggestions.map(s => `${s.tagName} [Ref: ${s.refId}]: "${s.text ?? s.name}"`),
      details: suggestions.length > 0 ? 'Autocomplete suggestions successfully observed.' : 'Dynamic autocomplete popup omitted from observations.'
    });
  } catch (err: any) {
    console.error('Error auditing Cambridge dynamic surface:', err.message);
  }

  // 3. Amazon department selector
  try {
    await page.goto('https://www.amazon.com/');
    await page.waitForTimeout(2000);
    
    // Hover or click department selector dropdown (All selector)
    const select = page.locator('#searchDropdownBox');
    const inDom = await select.count() > 0;
    
    const raw: any = await observer.capture({ page, sessionId: 'surface_dyn', generationId: 3 });
    raw.nodes = raw.refs.map((r: any) => {
      const attributes: Record<string, string> = {};
      let id: string | undefined = undefined;
      for (const selector of r.selectorCandidates || []) {
        if (selector.startsWith('#')) {
          id = selector.slice(1);
        } else {
          const match = selector.match(/\[([^=]+)="([^"]+)"\]/);
          if (match) {
            attributes[match[1]] = match[2];
          }
        }
      }
      return {
        tagName: r.tagName,
        id,
        name: r.name,
        attributes,
        text: r.text,
      };
    });

    const obs = refService.assign(raw);
    const targets = obs.refs.filter(r => r.tagName === 'select' || r.tagName === 'option');

    results.push({
      surfaceName: 'Amazon Department Dropdown Select',
      inPlaywrightDom: inDom,
      crawledRawCount: raw.nodes.length,
      refGeneratedCount: obs.refs.length,
      detectedTargets: targets.slice(0, 5).map(t => `${t.tagName} [Ref: ${t.refId}]: "${t.text ?? t.name}"`),
      details: targets.length > 0 ? 'Department select dropdown target successfully observed.' : 'Select dropdown option nodes missing from observations.'
    });
  } catch (err: any) {
    console.error('Error auditing Amazon dynamic select surface:', err.message);
  }

  // 4. GitHub repository branch switcher dropdown
  try {
    await page.goto('https://github.com/Utkarsh-X/browsegent');
    await page.waitForTimeout(2000);

    const btn = page.locator('#branch-select-menu, summary:has-text("main")').first();
    const inDom = await btn.count() > 0;
    if (inDom) {
      await btn.click();
      await page.waitForTimeout(1000); // let panel render
    }

    const raw: any = await observer.capture({ page, sessionId: 'surface_dyn', generationId: 4 });
    raw.nodes = raw.refs.map((r: any) => {
      const attributes: Record<string, string> = {};
      let id: string | undefined = undefined;
      for (const selector of r.selectorCandidates || []) {
        if (selector.startsWith('#')) {
          id = selector.slice(1);
        } else {
          const match = selector.match(/\[([^=]+)="([^"]+)"\]/);
          if (match) {
            attributes[match[1]] = match[2];
          }
        }
      }
      return {
        tagName: r.tagName,
        id,
        name: r.name,
        attributes,
        text: r.text,
      };
    });

    const obs = refService.assign(raw);
    
    // Find options/elements in branch panel switcher
    const branches = obs.refs.filter(r => r.text?.toLowerCase().includes('experiment-rope') || r.name?.toLowerCase().includes('experiment-rope') || r.text === 'validation-suite');

    results.push({
      surfaceName: 'GitHub Branch Switcher Panel',
      inPlaywrightDom: inDom,
      crawledRawCount: raw.nodes.length,
      refGeneratedCount: obs.refs.length,
      detectedTargets: branches.map(b => `${b.tagName} [Ref: ${b.refId}]: "${b.text ?? b.name}"`),
      details: branches.length > 0 ? 'Dynamic switcher panel options successfully observed.' : 'Branch switcher items missing or occluded.'
    });
  } catch (err: any) {
    console.error('Error auditing GitHub branch switcher:', err.message);
  }

  return results;
}

async function traceLineage(
  page: Page,
  observer: ObservationService,
  refService: RefService,
  selector: PlannerWorkingSetSelector
): Promise<LineageTrace[]> {
  const traces: LineageTrace[] = [];

  // Helper function to build the full pipeline and check if an element exists at each step
  async function traceControl(
    url: string,
    controlName: string,
    rawMatcher: (node: any) => boolean,
    refMatcher: (ref: any) => boolean
  ): Promise<LineageTrace> {
    await page.goto(url);
    await page.waitForTimeout(2000);

    const rawObs: any = await observer.capture({ page, sessionId: 'lineage', generationId: 1 });
    const nodes = rawObs.refs.map((r: any) => {
      const attributes: Record<string, string> = {};
      let id: string | undefined = undefined;
      for (const selector of r.selectorCandidates || []) {
        if (selector.startsWith('#')) {
          id = selector.slice(1);
        } else {
          const match = selector.match(/\[([^=]+)="([^"]+)"\]/);
          if (match) {
            attributes[match[1]] = match[2];
          }
        }
      }
      return {
        tagName: r.tagName,
        id,
        name: r.name,
        attributes,
        text: r.text,
      };
    });
    rawObs.nodes = nodes;
    const obs = refService.assign(rawObs);

    const projection = {
      projectionId: 'proj_lineage',
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
      goal: 'Audit lineage paths',
      projection,
    });

    const isRawObserved = rawObs.nodes.some(rawMatcher);
    const matchedRef = obs.refs.find(refMatcher);
    const isRefGenerated = !!matchedRef;

    let isActionable = false;
    let actStatus = 'not_found';
    let isWorkingSet = false;
    let wsReason = 'not_found';

    if (matchedRef) {
      const surface = selection.workingSet.actionSurface;
      isActionable = surface.clickableRefs.includes(matchedRef.refId) ||
                     surface.typeableRefs.includes(matchedRef.refId) ||
                     surface.selectableRefs.includes(matchedRef.refId);
      
      actStatus = matchedRef.actionability;

      const wsItem: any = selection.workingSet.primaryRefs.find(r => r.refId === matchedRef.refId) ??
                   selection.workingSet.secondaryRefs.find(r => r.refId === matchedRef.refId);
      isWorkingSet = !!wsItem;
      wsReason = wsItem ? (wsItem.includeReason ?? wsItem.reasons?.join(', ')) : 'Dropped during Working Set compression';
    }

    return {
      controlName,
      observed: isRawObserved,
      refGenerated: isRefGenerated,
      refId: matchedRef?.refId,
      actionable: isActionable,
      actionableStatus: actStatus,
      workingSet: isWorkingSet,
      wsReason
    };
  }

  // 1. Wikipedia Search Input
  try {
    const trace = await traceControl(
      'https://www.wikipedia.org/',
      'Wikipedia Search Input',
      n => n.tagName?.toLowerCase() === 'input' && n.name === 'search',
      r => r.tagName === 'input' && (r.name?.toLowerCase().includes('search') || r.text?.toLowerCase().includes('search'))
    );
    traces.push(trace);
  } catch (err: any) {
    console.error('Wikipedia lineage trace failed:', err.message);
  }

  // 2. Cambridge Search Input
  try {
    const trace = await traceControl(
      'https://dictionary.cambridge.org/',
      'Cambridge Dictionary Search Input',
      n => n.tagName?.toLowerCase() === 'input' && n.name === 'q',
      r => r.tagName === 'input' && (r.name?.toLowerCase().includes('search') || r.text?.toLowerCase().includes('search'))
    );
    traces.push(trace);
  } catch (err: any) {
    console.error('Cambridge lineage trace failed:', err.message);
  }

  // 3. Amazon Search Input
  try {
    const trace = await traceControl(
      'https://www.amazon.com/',
      'Amazon Search Input',
      n => n.tagName?.toLowerCase() === 'input' && n.id === 'twotabsearchtextbox',
      r => r.tagName === 'input' && (r.name?.toLowerCase().includes('search') || r.text?.toLowerCase().includes('search'))
    );
    traces.push(trace);
  } catch (err: any) {
    console.error('Amazon lineage trace failed:', err.message);
  }

  // 4. GitHub Issues Tab Link
  try {
    const trace = await traceControl(
      'https://github.com/Utkarsh-X/browsegent',
      'GitHub Issues Tab Link',
      n => n.tagName?.toLowerCase() === 'a' && n.attributes?.['data-tab-item'] === 'issues-tab',
      r => r.role === 'link' && r.name === 'Issues'
    );
    traces.push(trace);
  } catch (err: any) {
    console.error('GitHub lineage trace failed:', err.message);
  }

  return traces;
}


async function run() {
  console.log('Starting Lineage and Dynamic Surface Audit...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  const observer = new ObservationService();
  const refService = new RefService();
  const selector = new PlannerWorkingSetSelector();

  // 1. Run Dynamic Surface Audits
  const surfaces = await auditDynamicSurfaces(page, observer, refService);

  // 2. Run Lineage Traces
  const lineages = await traceLineage(page, observer, refService, selector);

  await browser.close();

  // Build Markdown Report
  let markdown = `# Final Architectural & Observation Validation Findings Report\n\n`;
  markdown += `Generated on: ${new Date().toISOString()}\n\n`;

  markdown += `## 1. Dynamic Interactive Surface Audit (Cycle 3)\n\n`;
  markdown += `| Interactive Surface | In Playwright DOM | Raw Crawl Nodes | Ref Generated Count | Detected Key Targets | Details |\n`;
  markdown += `| :--- | :---: | :---: | :---: | :--- | :--- |\n`;
  for (const s of surfaces) {
    markdown += `| ${s.surfaceName} | \`${s.inPlaywrightDom}\` | ${s.crawledRawCount} | ${s.refGeneratedCount} | ${s.detectedTargets.join('<br>') || 'None'} | ${s.details} |\n`;
  }
  markdown += `\n`;

  markdown += `## 2. End-to-End Control Lineage Audit (Cycle 4)\n\n`;
  markdown += `| Target Control | Observed | Ref Generated | Ref ID | Actionable | Actionable Status | Working Set | Selection / Drop Reason |\n`;
  markdown += `| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |\n`;
  for (const l of lineages) {
    markdown += `| ${l.controlName} | \`${l.observed}\` | \`${l.refGenerated}\` | \`${l.refId ?? '-'}\` | \`${l.actionable}\` | \`${l.actionableStatus}\` | \`${l.workingSet}\` | ${l.wsReason} |\n`;
  }
  markdown += `\n`;

  const dest = resolve(__dirname, '../docs/superpowers/specs/VALIDATION_FINDINGS_REPORT.md');
  writeFileSync(dest, markdown, 'utf8');
  console.log(`Validation findings log complete! Report written to ${dest}`);
}

run().catch(console.error);
