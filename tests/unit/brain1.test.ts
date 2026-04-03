import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { chromium, type Browser, type Page } from 'playwright';

import type { Brain1Result, FilteredNode } from '../../src/brain1/types';
import { Brain1Service } from '../../src/brain1/service';
import { serializeGraph } from '../../src/graph/serializer';
import type { SemanticGraph } from '../../src/graph/types';

const contentBundlePath = path.resolve('extension/content.js');

let browser: Browser;

test.before(async () => {
  browser = await chromium.launch({ headless: true });
});

test.after(async () => {
  await browser.close();
});

async function withBrainPage<T>(html: string, fn: (page: Page) => Promise<T>): Promise<T> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  try {
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: contentBundlePath });
    return await fn(page);
  } finally {
    await page.close();
  }
}

async function scanPage(page: Page, goal = ''): Promise<Brain1Result> {
  return page.evaluate((goalText) => (window as any).__browsegent_brain1(document.body, goalText), goal);
}

function makeGraph(snapshot: FilteredNode[]): SemanticGraph {
  return {
    snapshot,
    deltas: [],
    status: 'live',
    lastCause: null,
    errors: [],
    pageUrl: 'https://example.com',
    snapshotTimestamp: Date.now(),
    lastUpdateTimestamp: Date.now(),
  };
}

function makeMeta(overrides: Partial<NonNullable<FilteredNode['meta']>> = {}): NonNullable<FilteredNode['meta']> {
  return {
    nodeId: 'node-default',
    selectorScore: 10,
    interactionScore: 4,
    actionabilityScore: 8,
    interactionKind: 'generic',
    confidence: 'low',
    enrichmentState: 'base',
    goalScore: 0,
    visibility: 'visible',
    selectorSource: 'positional',
    ...overrides,
  };
}

test('Brain1 prefers stable selectors and emits selector metadata', async () => {
  await withBrainPage(`
    <main>
      <input id="primary-search" placeholder="Search docs" />
      <button data-testid="search-submit">Search</button>
      <input name="secondary-search" placeholder="Search archive" />
    </main>
  `, async (page) => {
    const result = await scanPage(page, 'search docs');
    const input = result.nodes.find(node => node.sel === '#primary-search');
    const button = result.nodes.find(node => node.sel.includes('[data-testid="search-submit"]'));

    assert.ok(input);
    assert.equal(input.meta?.selectorSource, 'id');
    assert.equal(input.meta?.visibility, 'visible');
    assert.ok((input.meta?.selectorScore ?? 0) > 80);

    assert.ok(button);
    assert.equal(button.meta?.selectorSource, 'testid');
    assert.equal(button.type, 'trigger');
  });
});

test('Brain1 distinguishes visible, offscreen, hidden, and disabled controls', async () => {
  await withBrainPage(`
    <main>
      <input id="visible-search" placeholder="Visible search" />
      <div style="height: 1800px;"></div>
      <input id="offscreen-search" placeholder="Archive search" />
      <button id="disabled-search" disabled>Search disabled</button>
      <button id="hidden-search" style="display:none">Hidden action</button>
    </main>
  `, async (page) => {
    const result = await scanPage(page, 'search');
    const visible = result.nodes.find(node => node.sel === '#visible-search');
    const offscreen = result.nodes.find(node => node.sel === '#offscreen-search');
    const disabled = result.nodes.find(node => node.sel === '#disabled-search');
    const hidden = result.nodes.find(node => node.sel === '#hidden-search');

    assert.equal(visible?.meta?.visibility, 'visible');
    assert.equal(offscreen?.meta?.visibility, 'offscreen');
    assert.equal(disabled?.meta?.disabled, true);
    assert.equal(disabled?.type, 'trigger');
    assert.equal(hidden, undefined);
  });
});

test('Brain1 detects role-based triggers and contenteditable inputs', async () => {
  await withBrainPage(`
    <main>
      <div role="button" aria-label="Open filters">Open filters</div>
      <div contenteditable="true">Editable notes</div>
    </main>
  `, async (page) => {
    const result = await scanPage(page, 'filters notes');
    const roleButton = result.nodes.find(node => node.value.includes('Open filters'));
    const editable = result.nodes.find(node => node.value.includes('Editable notes'));

    assert.ok(roleButton);
    assert.equal(roleButton.type, 'trigger');
    assert.equal(roleButton.meta?.role, 'button');

    assert.ok(editable);
    assert.equal(editable.type, 'input');
  });
});

test('Brain1 detects tabindex-only triggers and wrapped input labels', async () => {
  await withBrainPage(`
    <main>
      <div tabindex="0" aria-label="Open search">Search launcher</div>
      <label class="search-wrapper">
        <span>Search docs</span>
        <input placeholder="Search docs input" />
      </label>
    </main>
  `, async (page) => {
    const result = await scanPage(page, 'search docs');
    const tabindexTrigger = result.nodes.find(node => node.type === 'trigger' && node.value.includes('Search launcher'));
    const wrappedInput = result.nodes.find(node => node.value.includes('Search docs input'));

    assert.ok(tabindexTrigger);
    assert.equal(tabindexTrigger.type, 'trigger');
    assert.equal(tabindexTrigger.meta?.interactionKind, 'generic');

    assert.ok(wrappedInput);
    assert.equal(wrappedInput.type, 'input');
    assert.equal(wrappedInput.meta?.interactionKind, 'input');
  });
});

test('Brain1 detects search-icon button patterns as triggers', async () => {
  await withBrainPage(`
    <main>
      <button class="search-button icon-button" aria-label="Search products" style="width:32px;height:32px"></button>
      <span id="decorative-glass">Lens</span>
    </main>
  `, async (page) => {
    const result = await scanPage(page, 'search products');
    const searchButton = result.nodes.find(node => node.value === 'Search products');
    const decorative = result.nodes.find(node => node.value.includes('Lens'));

    assert.ok(searchButton);
    assert.equal(searchButton.type, 'trigger');
    assert.ok((searchButton.meta?.interactionScore ?? 0) >= 50);
    assert.equal(decorative, undefined);
  });
});

test('Brain1 detects open shadow-root controls and marks them as shadow-derived', async () => {
  await withBrainPage(`
    <main>
      <div id="search-host"></div>
    </main>
  `, async (page) => {
    await page.evaluate(() => {
      const host = document.getElementById('search-host')!;
      const shadow = host.attachShadow({ mode: 'open' });
      const input = document.createElement('input');
      input.setAttribute('placeholder', 'Shadow search');
      const button = document.createElement('button');
      button.textContent = 'Run shadow search';
      shadow.append(input, button);
    });

    const result = await scanPage(page, 'shadow search');
    const shadowInput = result.nodes.find(node => node.value.includes('Shadow search'));
    const shadowButton = result.nodes.find(node => node.value.includes('Run shadow search'));

    assert.ok(shadowInput);
    assert.equal(shadowInput.meta?.shadow, true);
    assert.equal(shadowInput.sel, '#search-host');

    assert.ok(shadowButton);
    assert.equal(shadowButton.meta?.shadow, true);
  });
});

test('Brain1Service applies enrichment and merges local region rescans without widening the API', async () => {
  await withBrainPage(`
    <main>
      <ul>
        <li class="job-card">
          <a href="/jobs/1">Python Developer</a>
          <button>Apply</button>
        </li>
        <li class="job-card">
          <a href="/jobs/2">Python Developer</a>
          <button>Apply</button>
        </li>
      </ul>
    </main>
  `, async (page) => {
    const regionCalls: string[] = [];
    let enrichmentCalls = 0;

    const service = new Brain1Service(page, {
      enableInteractionPipeline: true,
      enricher: async (node) => {
        enrichmentCalls += 1;
        if (node.type === 'trigger') {
          return {
            nodeId: node.meta!.nodeId,
            interactionScoreDelta: 12,
            actionabilityScoreDelta: 4,
            confidence: 'low',
            enrichmentState: 'enriched',
          };
        }
        return null;
      },
      regionScanner: async (regionSelector) => {
        regionCalls.push(regionSelector);
        return {
          nodes: [
            {
              type: 'data',
              tag: 'span',
              value: 'Acme Corp',
              sel: `${regionSelector} > .company`,
              selType: 'positional',
              rule: 'region_rescan',
              meta: makeMeta({
                nodeId: `region-${regionSelector}`,
                selectorScore: 60,
                interactionScore: 10,
                actionabilityScore: 18,
                interactionKind: 'generic',
                confidence: 'medium',
                goalScore: 22,
                regionSelector,
              }),
            },
          ],
          metrics: {
            totalNodesWalked: 4,
            nodesKept: 1,
            nodesDropped: 3,
            walkTimeMs: 1,
            shadowDomCount: 0,
            rulesTriggered: { region_rescan: 1 },
            selectorTypes: { positional: 1 },
          },
          errors: [],
        };
      },
    });

    const result = await service.scan('What company posted the first job listing shown?');

    assert.ok(enrichmentCalls > 0);
    assert.ok(regionCalls.length > 0);
    assert.ok(regionCalls.length <= 2);
    assert.ok(result.nodes.some(node => node.value === 'Acme Corp'));
    assert.ok(result.nodes.some(node => node.meta?.enrichmentState === 'enriched'));
  });
});

test('serializeGraph uses Brain1 scores to keep strong late-arriving nodes', () => {
  const lowNodes: FilteredNode[] = Array.from({ length: 30 }, (_, index) => ({
    type: 'data',
    tag: 'div',
    value: `Low value ${index}`,
    sel: `div:nth-of-type(${index + 1})`,
    selType: 'positional',
    rule: 'test',
    meta: makeMeta({
      nodeId: `low-${index}`,
      selectorScore: 10,
      interactionScore: 4,
      actionabilityScore: 8,
      interactionKind: 'generic',
      confidence: 'low',
      enrichmentState: 'base',
      goalScore: 0,
      visibility: 'visible',
      selectorSource: 'positional',
    }),
  }));

  const winner: FilteredNode = {
    type: 'data',
    tag: 'div',
    value: 'Python json.dumps default parameters',
    sel: '#winner',
    selType: 'id',
    rule: 'test',
    meta: makeMeta({
      nodeId: 'winner',
      selectorScore: 95,
      interactionScore: 20,
      actionabilityScore: 24,
      interactionKind: 'generic',
      confidence: 'high',
      enrichmentState: 'base',
      goalScore: 32,
      visibility: 'visible',
      selectorSource: 'id',
    }),
  };

  const { serialized } = serializeGraph(makeGraph([...lowNodes, winner]), 'json dumps defaults');
  assert.ok(serialized.d.some(entry => entry[2] === '#winner'));
});

test('serializeGraph keeps richer Brain1 metadata out of the LLM payload', () => {
  const node: FilteredNode = {
    type: 'input',
    tag: 'input',
    value: 'Search docs',
    sel: '#search',
    selType: 'id',
    rule: 'test',
    meta: makeMeta({
      nodeId: 'search-node',
      selectorScore: 91,
      interactionScore: 80,
      actionabilityScore: 72,
      interactionKind: 'input',
      confidence: 'high',
      enrichmentState: 'base',
      goalScore: 18,
      visibility: 'visible',
      selectorSource: 'id',
    }),
  };

  const { serialized } = serializeGraph(makeGraph([node]), 'search docs');
  const json = JSON.stringify(serialized);

  assert.doesNotMatch(json, /selectorScore|interactionScore|goalScore|selectorSource/);
  assert.ok(serialized.d.some(entry => entry[2] === '#search'));
});
