import type { V2Ref } from '../runtime/types';
import type { ProjectionItem, ProjectionItemKind } from './projectionTypes';

export function toProjectionItem(ref: V2Ref): ProjectionItem {
  return {
    refId: ref.refId,
    kind: inferProjectionKind(ref),
    role: ref.role,
    name: ref.name,
    text: ref.text,
    visibility: ref.visibility,
    actionability: ref.actionability,
    state: ref.state,
    continuityConfidence: ref.continuityConfidence,
    score: scoreRef(ref),
  };
}

export function sortProjectionItems(items: ProjectionItem[]): ProjectionItem[] {
  return [...items].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.refId.localeCompare(right.refId);
  });
}

function scoreRef(ref: V2Ref): number {
  let score = 0;

  if (ref.visibility === 'visible') score += 40;
  if (ref.visibility === 'offscreen') score += 15;
  if (ref.actionability === 'ready') score += 30;
  if (ref.actionability === 'disabled') score += 5;
  if (ref.state === 'live') score += 15;
  if (ref.state === 'weakened') score += 5;

  score += Math.round(ref.continuityConfidence * 10);

  if (ref.role) score += 4;
  if (ref.name) score += Math.min(10, ref.name.length);
  if (ref.text) score += Math.min(6, ref.text.length);

  return score;
}

function inferProjectionKind(ref: V2Ref): ProjectionItemKind {
  const role = ref.role?.toLowerCase();
  if (role === 'link') return 'link';
  if (role === 'button' || role === 'tab' || role === 'menuitem') return 'button';
  if (role === 'combobox') return 'select';
  if (role === 'textbox' || role === 'searchbox') return 'input';

  const selectorText = ref.selectorCandidates.join(' ').toLowerCase();
  if (selectorText.includes('contenteditable')) return 'editable';
  if (selectorText.includes('<select') || selectorText.includes('select')) return 'select';
  if (selectorText.includes('input') || selectorText.includes('textarea')) return 'input';
  if (selectorText.includes('href=')) return 'link';

  return 'generic';
}
