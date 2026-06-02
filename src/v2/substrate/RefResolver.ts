import type { Locator, Page } from 'playwright';

import { V2OperationalError } from '../runtime/errors';
import type { V2Ref } from '../runtime/types';

const MAX_CANDIDATES_PER_SELECTOR = 5;

export interface ResolvedRefTarget {
  locator: Locator;
  resolution: 'unique_selector' | 'semantic_selector';
}

interface ScoredCandidate {
  locator: Locator;
  score: number;
  identityKey: string;
}

export class RefResolver {
  async resolve(ref: V2Ref, page: Page): Promise<ResolvedRefTarget> {
    const candidates = new Map<string, ScoredCandidate>();
    let overflowed = false;

    for (const selector of ref.selectorCandidates) {
      let locator: Locator;
      try {
        locator = page.locator(selector);
      } catch {
        continue;
      }

      const count = await locator.count().catch(() => 0);
      if (count > MAX_CANDIDATES_PER_SELECTOR) {
        overflowed = true;
      }

      for (let index = 0; index < Math.min(count, MAX_CANDIDATES_PER_SELECTOR); index += 1) {
        const candidate = locator.nth(index);
        const scored = await scoreCandidate(candidate, ref).catch(() => undefined);
        if (!scored || scored.score < 100) {
          continue;
        }

        const existing = candidates.get(scored.identityKey);
        if (!existing || scored.score > existing.score) {
          candidates.set(scored.identityKey, { locator: candidate, ...scored });
        }
      }
    }

    const sorted = [...candidates.values()].sort((left, right) => right.score - left.score);
    if (sorted.length === 0) {
      throw new V2OperationalError('stale_ref', `Ref "${ref.refId}" no longer resolves to a verified target.`, { retryable: false });
    }

    if (sorted.length > 1 && sorted[0].score === sorted[1].score) {
      throw new V2OperationalError('ambiguous_ref_resolution', `Ref "${ref.refId}" resolved to multiple equivalent candidates.`, { retryable: false });
    }

    if (overflowed && sorted[0].score < 140) {
      throw new V2OperationalError('ambiguous_ref_resolution', `Ref "${ref.refId}" matched too many weak selector candidates.`, { retryable: false });
    }

    return {
      locator: sorted[0].locator,
      resolution: sorted[0].score >= 140 ? 'semantic_selector' : 'unique_selector',
    };
  }
}

async function scoreCandidate(locator: Locator, ref: V2Ref): Promise<{ score: number; identityKey: string }> {
  return locator.evaluate((element, expected) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const visible = !element.hasAttribute('hidden')
      && style.display !== 'none'
      && style.visibility !== 'hidden'
      && style.opacity !== '0'
      && rect.width > 0
      && rect.height > 0;

    const identityKey = [
      element.tagName.toLowerCase(),
      Math.round(rect.left),
      Math.round(rect.top),
      Math.round(rect.width),
      Math.round(rect.height),
      normalize(element.textContent || ''),
    ].join('|');

    if (!visible) {
      return { score: -1, identityKey };
    }

    let score = 100;
    const tagName = element.tagName.toLowerCase();
    const role = normalize(element.getAttribute('role') || nativeRole(element));
    const ariaLabel = normalize(
      element.getAttribute('aria-label')
      || element.getAttribute('placeholder')
      || element.getAttribute('title')
      || '',
    );
    const text = normalize(element.textContent || '');
    const name = normalize(expected.name || '');
    const expectedText = normalize(expected.text || '');

    if (expected.tagName && tagName === normalize(expected.tagName)) score += 15;
    if (expected.role && role === normalize(expected.role)) score += 15;
    if (name && (ariaLabel === name || text === name)) score += 30;
    if (expectedText && text === expectedText) score += 20;

    return { score, identityKey };

    function nativeRole(target: Element): string {
      const targetTagName = target.tagName.toLowerCase();
      if (targetTagName === 'a') return 'link';
      if (targetTagName === 'button') return 'button';
      if (targetTagName === 'select') return 'combobox';
      if (targetTagName === 'textarea') return 'textbox';
      if (targetTagName === 'input') {
        const inputType = String(target.getAttribute('type') || 'text').toLowerCase();
        if (['button', 'submit', 'reset', 'image'].includes(inputType)) return 'button';
        if (inputType === 'search') return 'searchbox';
        return 'textbox';
      }
      return '';
    }

    function normalize(value: string): string {
      return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }
  }, {
    tagName: ref.tagName,
    role: ref.role,
    name: ref.name,
    text: ref.text,
  });
}
