import { SelectorType } from './types';

export interface SelectorResult {
  selector: string;
  type: SelectorType;
  isPositional: boolean;
}

export function getSelector(el: Element): SelectorResult {
  // Priority 1 — ID (most stable)
  if (el.id && el.id.trim() !== '') {
    return { selector: `#${CSS.escape(el.id)}`, type: 'id', isPositional: false };
  }

  // Priority 2 — aria-label (semantic, survives redesigns)
  const aria = el.getAttribute('aria-label');
  if (aria && aria.trim() !== '') {
    return { selector: `[aria-label="${aria.replace(/"/g, '\\"')}"]`, type: 'aria', isPositional: false };
  }

  // Priority 3 — name attribute (form fields)
  const name = el.getAttribute('name');
  if (name && name.trim() !== '') {
    return { selector: `[name="${name.replace(/"/g, '\\"')}"]`, type: 'name', isPositional: false };
  }

  // Priority 4 — data-testid (developer-friendly sites)
  const testid = el.getAttribute('data-testid');
  if (testid && testid.trim() !== '') {
    return { selector: `[data-testid="${testid.replace(/"/g, '\\"')}"]`, type: 'testid', isPositional: false };
  }

  // Priority 5 — positional (last resort — fragile)
  return {
    selector: buildPositionalSelector(el),
    type: 'positional',
    isPositional: true
  };
}

function buildPositionalSelector(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;

  while (current && current !== document.body) {
    const tag = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;
    if (!parent) break;

    const currentTag = current.tagName;
    const siblings = Array.from(parent.children).filter(
      c => c.tagName === currentTag
    );

    if (siblings.length === 1) {
      parts.unshift(tag);
    } else {
      const index = siblings.indexOf(current) + 1;
      parts.unshift(`${tag}:nth-of-type(${index})`);
    }
    current = parent;
  }

  return parts.join(' > ') || el.tagName.toLowerCase();
}
