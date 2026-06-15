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
          { name: 'Search Input', matcher: r => r.tagName === 'input' && (r.name?.toLowerCase().includes('search') || r.text?.toLowerCase().includes('search')) },
          { name: 'Language Dropdown', matcher: r => r.tagName === 'select' && (r.name?.toLowerCase().includes('language') || r.text?.toLowerCase().includes('language')) },
          { name: 'Search Button', matcher: r => r.tagName === 'button' && (r.name?.toLowerCase().includes('search') || r.text?.toLowerCase().includes('search')) }
        ]
      },
      {
        stateLabel: 'State B (Type Search Query)',
        action: async (page) => {
          const input = page.locator('input[name="search"]');
          await input.fill('software engineering');
        },
        expectedControls: [
          { name: 'Search Input', matcher: r => r.tagName === 'input' && (r.name?.toLowerCase().includes('search') || r.text?.toLowerCase().includes('search')) }
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
          { name: 'Search Input', matcher: r => r.tagName === 'input' && (r.name?.toLowerCase().includes('search') || r.text?.toLowerCase().includes('search')) },
          { name: 'Search Button', matcher: r => r.tagName === 'button' && (r.name?.toLowerCase().includes('search') || r.text?.toLowerCase().includes('search')) }
        ]
      },
      {
        stateLabel: 'State B (Autocomplete Dropdown)',
        action: async (page) => {
          const input = page.locator('input[name="q"]').first();
          await input.fill('sustainability');
          await page.waitForTimeout(1500); // Let autocomplete paint
        },
        expectedControls: [
          { name: 'Search Input', matcher: r => r.tagName === 'input' && (r.name?.toLowerCase().includes('search') || r.text?.toLowerCase().includes('search')) },
          { name: 'Autocomplete Popup Item', matcher: r => r.name?.toLowerCase().includes('sustainability') || r.text?.toLowerCase().includes('sustainability') }
        ]
      },
      {
        stateLabel: 'State C (Definition Page)',
        action: async (page) => {
          await page.keyboard.press('Enter');
          await page.waitForTimeout(3000);
        },
        expectedControls: [
          { name: 'UK pronunciation speaker', matcher: r => r.name?.toLowerCase().includes('uk') || r.name?.toLowerCase().includes('listen') },
          { name: 'US pronunciation speaker', matcher: r => r.name?.toLowerCase().includes('us') || r.name?.toLowerCase().includes('listen') }
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
          { name: 'Search input', matcher: r => r.tagName === 'input' && (r.name?.toLowerCase().includes('search') || r.text?.toLowerCase().includes('search')) },
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
          { name: 'Search input', matcher: r => r.tagName === 'input' && (r.name?.toLowerCase().includes('search') || r.text?.toLowerCase().includes('search')) }
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
          { name: 'Search input', matcher: r => r.tagName === 'input' && (r.name?.toLowerCase().includes('search') || r.text?.toLowerCase().includes('search')) }
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
          // Simply find the first link inside an h3 header and click it
          const firstPost = page.locator('a[href*="/r/javascript/comments/"]').first();
          await firstPost.click().catch(() => page.goto(page.url()));
          await page.waitForTimeout(3000);
        },
        expectedControls: [
          { name: 'Upvote button', matcher: r => r.role === 'button' && (r.name === 'Upvote' || r.text === 'Upvote') }
        ]
      }
    ]
  }
];

export { SITE_CONFIGS };

async function computeStability(
  page: Page,
  observer: ObservationService,
  refService: RefService
): Promise<number> {
  const counts: number[] = [];
  const idSets: Set<string>[] = [];
  
  for (let i = 0; i < 5; i++) {
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
    const found = obs.refs ? obs.refs.some(expected.matcher) : false;
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
    totalNodes: obs.refs ? obs.refs.length : 0,
    actionableRefs: actionableCount,
    lossRate,
    duplicateDensity: calculateDuplicateDensity(obs.refs ?? []),
    actionabilityCoverage: (obs.refs && obs.refs.length > 0) ? actionableCount / obs.refs.length : 0,
    stabilityVariance,
    observationTimeMs: t1 - t0,
    refGenerationTimeMs: t2 - t1,
    workingSetTimeMs: t3 - t2,
    missingControlsList
  };
}

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

