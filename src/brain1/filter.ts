import { FilteredNode, Brain1Result, NodeType } from './types';
import { getSelector } from './selector';

// Trigger keywords — R3
const TRIGGER_KEYWORDS = /buy|submit|login|sign.?in|load|next|add|search|continue|checkout|confirm|proceed|apply|register|subscribe/i;

// Skip class patterns — R5
const SKIP_CLASS_PATTERNS = /loader|spinner|hidden|loading|skeleton|placeholder|overlay-bg|backdrop/i;

// Minimum text length — R1
const MIN_TEXT_LENGTH = 5;

// R6 — Container tags that are likely layout wrappers
const CONTAINER_TAGS = new Set(['div', 'span', 'section', 'article', 'main', 'aside', 'nav', 'header', 'footer']);

// Tags to skip entirely — never contain user-visible content
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'svg', 'template', 'iframe', 'canvas', 'video', 'audio', 'head', 'meta', 'link']);

/**
 * Build goal-specific regex from a goal string.
 * "Get iPhone price" → /iphone|price|₹|\d+[,.]\d+/i
 * Excludes common generic words that over-match on navigation text.
 */
export function buildGoalPatterns(goal: string): RegExp {
  // Words that over-match on typical page navigation
  const STOP_WORDS = new Set([
    'find', 'from', 'this', 'that', 'with', 'what', 'page', 'site',
    'login', 'sign', 'account', 'bank', 'home', 'online', 'click',
    'open', 'your', 'into', 'here',
  ]);

  const words = goal
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3)
    .filter(w => !STOP_WORDS.has(w));

  // If all goal words were stop words, fall back to keeping only
  // currency/numeric patterns — inputs and triggers are always kept regardless
  const patterns = words.length > 0
    ? [...words, '₹', '\\$', '\\d+[,.]\\d+']
    : ['₹', '\\$', '\\d+[,.]\\d+', 'password', 'username', 'user.?id', 'otp'];

  return new RegExp(patterns.join('|'), 'i');
}

/**
 * Core Brain 1 DOM filter.
 * @param root - DOM element to walk
 * @param goal - Optional goal string. When provided, R1 nodes are only kept
 *               if their text matches goal-derived patterns. Inputs (R2) and
 *               triggers (R3) are always kept regardless of goal.
 */
export function filterDOM(root: Element, goal?: string): Brain1Result {
  const startTime = performance.now();
  const nodes: FilteredNode[] = [];
  const errors: string[] = [];
  const rulesTriggered: Record<string, number> = { R1: 0, R2: 0, R3: 0, R4: 0, R5_skip: 0, R6_container: 0, R_goal_skip: 0 };
  const selectorTypes: Record<string, number> = { id: 0, aria: 0, name: 0, testid: 0, positional: 0 };
  let totalNodesWalked = 0;

  // Compile goal patterns if provided
  const goalPattern = goal ? buildGoalPatterns(goal) : null;

  function walk(el: Element): void {
    try {
      totalNodesWalked++;
      const tag = el.tagName.toLowerCase();

      // Skip non-visible content tags entirely (script, style, svg, etc.)
      if (SKIP_TAGS.has(tag)) return;

      const text = (el.textContent || '').trim();
      const value = (el as HTMLInputElement).value || '';
      const cls = (typeof el.className === 'string' ? el.className : '');

      // R5 — Skip loaders/spinners/hidden (unless they have real text content)
      if (SKIP_CLASS_PATTERNS.test(cls) && text.length < MIN_TEXT_LENGTH) {
        rulesTriggered['R5_skip']++;
        for (const child of Array.from(el.children)) {
          walk(child);
        }
        return;
      }

      let kept = false;
      let nodeType: NodeType = 'data';
      let matchedRule = '';

      // R2 — Always keep form fields (goal-independent)
      if (['input', 'select', 'textarea'].includes(tag)) {
        kept = true;
        nodeType = 'input';
        matchedRule = 'R2';
        rulesTriggered['R2']++;
      }

      // R4 — Keep table cells with content
      else if (['td', 'th'].includes(tag) && text.length > 0) {
        // If goal exists, only keep if text matches goal
        if (goalPattern && !goalPattern.test(text)) {
          rulesTriggered['R_goal_skip']++;
        } else {
          kept = true;
          nodeType = 'table_cell';
          matchedRule = 'R4';
          rulesTriggered['R4']++;
        }
      }

      // R3 — Keep buttons and links with trigger keywords (goal-independent)
      else if (['button', 'a'].includes(tag) && TRIGGER_KEYWORDS.test(text)) {
        kept = true;
        nodeType = 'trigger';
        matchedRule = 'R3';
        rulesTriggered['R3']++;
      }

      // R3 extended — onclick/role=button with trigger keywords
      else if (el.hasAttribute('onclick') || el.getAttribute('role') === 'button') {
        if (TRIGGER_KEYWORDS.test(text)) {
          kept = true;
          nodeType = 'trigger';
          matchedRule = 'R3';
          rulesTriggered['R3']++;
        }
      }

      // R1 — Keep nodes with meaningful text content
      else if (text.length > MIN_TEXT_LENGTH) {
        const meaningfulChildren = Array.from(el.children).filter(
          c => (c.textContent || '').trim().length > MIN_TEXT_LENGTH
        );
        if (meaningfulChildren.length === 0) {
          // R6: Skip container elements whose text comes from children
          if (CONTAINER_TAGS.has(tag)) {
            let directText = '';
            for (let i = 0; i < el.childNodes.length; i++) {
              if (el.childNodes[i].nodeType === 3) {
                directText += (el.childNodes[i].textContent || '').trim();
              }
            }
            if (directText.length <= MIN_TEXT_LENGTH) {
              rulesTriggered['R6_container']++;
            } else if (goalPattern && !goalPattern.test(directText)) {
              // Goal filter — data node doesn't match goal
              rulesTriggered['R_goal_skip']++;
            } else {
              kept = true;
              nodeType = 'data';
              matchedRule = 'R1';
              rulesTriggered['R1']++;
            }
          } else {
            // Non-container leaf node with text
            if (goalPattern && !goalPattern.test(text)) {
              rulesTriggered['R_goal_skip']++;
            } else {
              kept = true;
              nodeType = 'data';
              matchedRule = 'R1';
              rulesTriggered['R1']++;
            }
          }
        }
      }

      // Fallback: keep nodes with actual form value or placeholder (not bare aria-label)
      if (!kept) {
        const placeholder = el.getAttribute('placeholder');
        if (value || placeholder) {
          kept = true;
          nodeType = 'input';
          matchedRule = 'R2';
          rulesTriggered['R2']++;
        }
      }

      if (kept) {
        const selResult = getSelector(el);
        selectorTypes[selResult.type] = (selectorTypes[selResult.type] || 0) + 1;

        const node: FilteredNode = {
          type: nodeType,
          tag,
          value: value || text.slice(0, 200),
          sel: selResult.selector,
          selType: selResult.type,
          rule: matchedRule,
        };

        const placeholder = el.getAttribute('placeholder');
        const ariaLabel = el.getAttribute('aria-label');
        const href = (el as HTMLAnchorElement).href;
        const inputType = (el as HTMLInputElement).type;

        if (placeholder || ariaLabel || href || inputType) {
          node.attrs = {};
          if (placeholder) node.attrs.placeholder = placeholder;
          if (ariaLabel) node.attrs.ariaLabel = ariaLabel;
          if (href && tag === 'a') node.attrs.href = href.slice(0, 100);
          if (inputType && tag === 'input') node.attrs.inputType = inputType;
        }

        nodes.push(node);
      }

      // Walk children regardless
      for (const child of Array.from(el.children)) {
        walk(child);
      }

    } catch (err) {
      // P1 — never throw, only degrade
      errors.push(`walk error at ${el?.tagName}: ${err}`);
    }
  }

  try {
    walk(root);
  } catch (err) {
    errors.push(`root walk failed: ${err}`);
  }

  const walkTimeMs = performance.now() - startTime;

  return {
    nodes,
    metrics: {
      totalNodesWalked,
      nodesKept: nodes.length,
      nodesDropped: totalNodesWalked - nodes.length,
      walkTimeMs,
      rulesTriggered,
      selectorTypes,
    },
    errors,
  };
}
