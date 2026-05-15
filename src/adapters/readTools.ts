import type { Page } from 'playwright';

interface SearchMatch {
  matchText: string;
  context: string;
  elementPath: string;
}

interface SearchPagePayload {
  error?: string;
  total: number;
  matches: SearchMatch[];
  hasMore?: boolean;
}

interface FindElementsPayload {
  error?: string;
  total: number;
  showing: number;
  elements: Array<{
    index: number;
    tag: string;
    text?: string;
    attrs?: Record<string, string>;
    prices?: string[];
    childrenCount: number;
  }>;
}

interface InspectRegionPayload {
  error?: string;
  found: boolean;
  summary: string;
}

const READ_TEXT_LIMIT = 180;

const SEARCH_PAGE_EVAL = new Function('payload', `
  const normalize = (value, limit = 160) =>
    (value ?? '').replace(/\\s+/g, ' ').trim().slice(0, limit);

  const getPath = (element) => {
    if (!element) return '';
    const parts = [];
    let current = element;
    while (current && parts.length < 4 && current !== document.body && current !== document.documentElement) {
      let part = current.tagName.toLowerCase();
      const id = current.getAttribute('id');
      if (id) {
        part += '#' + id.slice(0, 30);
        parts.unshift(part);
        break;
      }
      const role = current.getAttribute('role');
      if (role) {
        part += '[role="' + role.slice(0, 20) + '"]';
      }
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(' > ');
  };

  try {
    const scopeRoot = payload.scope ? document.querySelector(payload.scope) : document.body;
    if (!scopeRoot) {
      return { error: 'Scope selector not found: ' + payload.scope, total: 0, matches: [] };
    }

    const normalizedPattern = (payload.searchPattern ?? '').trim();
    if (!normalizedPattern) {
      return { error: 'Search pattern cannot be empty', total: 0, matches: [] };
    }

    const walker = document.createTreeWalker(scopeRoot, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let allText = '';

    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.textContent ?? '';
      if (!text.trim()) continue;
      textNodes.push({ node, text, offset: allText.length });
      allText += text + ' ';
    }

    const haystack = allText.toLowerCase();
    const needle = normalizedPattern.toLowerCase();
    const matches = [];
    let total = 0;
    let position = 0;

    while (position < haystack.length) {
      const index = haystack.indexOf(needle, position);
      if (index === -1) break;
      total += 1;
      if (matches.length < 6) {
        const start = Math.max(0, index - 70);
        const end = Math.min(allText.length, index + needle.length + 70);
        let elementPath = '';
        for (const entry of textNodes) {
          if (entry.offset <= index && entry.offset + entry.text.length >= index) {
            elementPath = getPath(entry.node.parentElement);
            break;
          }
        }
        matches.push({
          matchText: normalize(allText.slice(index, index + needle.length), 80),
          context: (start > 0 ? '...' : '') + normalize(allText.slice(start, end), 180) + (end < allText.length ? '...' : ''),
          elementPath,
        });
      }
      position = index + Math.max(needle.length, 1);
    }

    return { total, matches, hasMore: total > matches.length };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      total: 0,
      matches: [],
    };
  }
`) as (payload: { searchPattern: string; scope: string | null }) => SearchPagePayload;

const FIND_ELEMENTS_EVAL = new Function('querySelector', `
  const normalize = (value, limit = 180) =>
    (value ?? '').replace(/\\s+/g, ' ').trim().slice(0, limit);
  const extractPriceCandidates = (text) => {
    const normalized = (text ?? '').replace(/\\s+/g, ' ').trim();
    if (!normalized) return [];
    const pattern = /(?:[$\\u20b9\\u20ac\\u00a3]\\s?\\d[\\d,]*(?:\\.\\d+)?|\\b(?:usd|inr|gbp|eur|aud|cad)\\b\\s?\\d[\\d,]*(?:\\.\\d+)?)/gi;
    const matches = normalized.match(pattern) ?? [];
    const unique = [];
    for (const match of matches) {
      const value = match.trim();
      if (!value) continue;
      if (!unique.includes(value)) unique.push(value);
      if (unique.length >= 4) break;
    }
    return unique;
  };

  try {
    const elements = document.querySelectorAll(querySelector);
    const total = elements.length;
    const showing = Math.min(total, 8);
    const results = [];

    for (let index = 0; index < showing; index += 1) {
      const element = elements[index];
      const fullText = element.textContent ?? '';
      const attrs = {};
      for (const attr of ['href', 'src', 'aria-label', 'name', 'role', 'placeholder', 'data-testid', 'data-test']) {
        const value = element.getAttribute(attr);
        if (value) {
          attrs[attr] = normalize(value, 100);
        }
      }
      results.push({
        index,
        tag: element.tagName.toLowerCase(),
        text: normalize(fullText),
        attrs: Object.keys(attrs).length ? attrs : undefined,
        prices: extractPriceCandidates(fullText),
        childrenCount: element.children.length,
      });
    }

    return { total, showing, elements: results };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      total: 0,
      showing: 0,
      elements: [],
    };
  }
`) as (selector: string) => FindElementsPayload;

const COUNT_ELEMENTS_EVAL = new Function('querySelector', `
  try {
    return document.querySelectorAll(querySelector).length;
  } catch {
    return -1;
  }
`) as (selector: string) => number;

const INSPECT_REGION_EVAL = new Function('regionSelector', `
  const extractPriceCandidates = (text) => {
    const normalized = (text ?? '').replace(/\\s+/g, ' ').trim();
    if (!normalized) return [];
    const pattern = /(?:[$\\u20b9\\u20ac\\u00a3]\\s?\\d[\\d,]*(?:\\.\\d+)?|\\b(?:usd|inr|gbp|eur|aud|cad)\\b\\s?\\d[\\d,]*(?:\\.\\d+)?)/gi;
    const matches = normalized.match(pattern) ?? [];
    const unique = [];
    for (const match of matches) {
      const value = match.trim();
      if (!value) continue;
      if (!unique.includes(value)) unique.push(value);
      if (unique.length >= 4) break;
    }
    return unique;
  };

  const summarizeFallback = (region) => {
    const text = (region.textContent ?? '').replace(/\\s+/g, ' ').trim().slice(0, 320);
    const interactiveCount = region.querySelectorAll('a,button,input,select,textarea,[role],[tabindex],[contenteditable]').length;
    const priceCandidates = extractPriceCandidates(region.textContent ?? '');
    const priceSummary = priceCandidates.length > 0
      ? ' | price candidates: ' + priceCandidates.join(', ')
      : '';
    return 'Region text: ' + (text || '(empty)') + ' | interactive descendants: ' + interactiveCount + priceSummary;
  };

  try {
    const region = document.querySelector(regionSelector);
    if (!region) {
      return { found: false, summary: 'Region not found: ' + regionSelector };
    }

    const scanner = window.__browsegent_brain1_region;
    if (typeof scanner !== 'function') {
      return { found: true, summary: summarizeFallback(region) };
    }

    const result = scanner(regionSelector);
    const nodes = Array.isArray(result?.nodes) ? result.nodes.slice(0, 8) : [];
    const regionText = (region.textContent ?? '').replace(/\\s+/g, ' ').trim();
    const nodeText = nodes
      .map(node => (node?.value ?? '').replace(/\\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' ');
    const priceCandidates = extractPriceCandidates((nodeText + ' ' + regionText).trim());
    const lines = [
      'Region "' + regionSelector + '" contains ' + nodes.length + ' notable node' + (nodes.length === 1 ? '' : 's') + '.',
    ];
    if (priceCandidates.length > 0) {
      lines.push('- price candidates ' + priceCandidates.join(', '));
    }

    for (const node of nodes) {
      const value = (node?.value ?? '').replace(/\\s+/g, ' ').trim().slice(0, 140);
      const sel = (node?.sel ?? '').slice(0, 80);
      lines.push('- ' + (node?.type ?? 'node') + ' ' + (value || '(empty)') + (sel ? ' @ ' + sel : ''));
    }

    if (nodes.length === 0) {
      lines.push(summarizeFallback(region));
    }

    return { found: true, summary: lines.join('\\n') };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      found: false,
      summary: '',
    };
  }
`) as (selector: string) => InspectRegionPayload;

export async function searchPageText(page: Page, pattern: string, scopeSelector?: string): Promise<string> {
  const payload = await page.evaluate(SEARCH_PAGE_EVAL, {
    searchPattern: pattern,
    scope: scopeSelector ?? null,
  });

  if (payload.error) {
    throw new Error(payload.error);
  }

  if (!payload.total) {
    return `No matches found for "${pattern}".`;
  }

  const lines = [`Found ${payload.total} match${payload.total === 1 ? '' : 'es'} for "${pattern}".`];
  for (const [index, match] of payload.matches.entries()) {
    lines.push(
      `${index + 1}. ${truncateInline(match.context, 220)}${match.elementPath ? ` @ ${match.elementPath}` : ''}`,
    );
  }
  if (payload.hasMore) {
    lines.push('Additional matches omitted.');
  }

  return lines.join('\n');
}

export async function findElementsSummary(page: Page, selector: string): Promise<string> {
  const payload = await page.evaluate(FIND_ELEMENTS_EVAL, selector);

  if (payload.error) {
    throw new Error(payload.error);
  }

  if (!payload.total) {
    return `Found 0 elements matching "${selector}".`;
  }

  const lines = [
    `Found ${payload.total} element${payload.total === 1 ? '' : 's'} matching "${selector}". Showing ${payload.showing}.`,
  ];

  for (const element of payload.elements) {
    const attrs = element.attrs
      ? ` attrs=${Object.entries(element.attrs).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(', ')}`
      : '';
    const text = element.text ? ` text=${JSON.stringify(truncateInline(element.text, READ_TEXT_LIMIT))}` : '';
    const prices = element.prices && element.prices.length > 0
      ? ` prices=${JSON.stringify(element.prices.slice(0, 3))}`
      : '';
    lines.push(`${element.index + 1}. <${element.tag}>${text}${attrs}${prices} children=${element.childrenCount}`);
  }

  return lines.join('\n');
}

export async function countElementsSummary(page: Page, selector: string): Promise<string> {
  const total = await page.evaluate(COUNT_ELEMENTS_EVAL, selector);
  if (total < 0) {
    throw new Error(`Invalid CSS selector: ${selector}`);
  }
  return `Count for "${selector}": ${total}`;
}

export async function inspectRegionSummary(page: Page, selector: string): Promise<string> {
  const payload = await page.evaluate(INSPECT_REGION_EVAL, selector);
  if (payload.error) {
    throw new Error(payload.error);
  }
  return payload.summary;
}

function truncateInline(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}
