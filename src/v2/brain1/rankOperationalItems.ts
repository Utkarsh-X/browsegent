import type { V2Ref } from '../runtime/types';
import { deriveRefCapabilities } from '../runtime/refCapabilities';
import type { ProjectionItem, ProjectionItemKind } from './projectionTypes';

export function toProjectionItem(ref: V2Ref): ProjectionItem {
  const capabilities = ref.capabilities ?? deriveRefCapabilities(ref);
  return {
    refId: ref.refId,
    kind: inferProjectionKind(ref, capabilities),
    role: ref.role,
    name: ref.name,
    text: ref.text,
    tagName: ref.tagName,
    inputType: ref.inputType,
    editableKind: ref.editableKind,
    capabilities,
    visibility: ref.visibility,
    actionability: ref.actionability,
    state: ref.state,
    continuityConfidence: ref.continuityConfidence,
    score: scoreRef(ref),
    selectOptions: ref.selectOptions,
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

function inferProjectionKind(ref: V2Ref, capabilities = ref.capabilities ?? deriveRefCapabilities(ref)): ProjectionItemKind {
  const role = ref.role?.toLowerCase();
  const tagName = ref.tagName?.toLowerCase();
  const inputType = ref.inputType?.toLowerCase() ?? '';
  if (role === 'link') return 'link';
  if (role === 'button' || role === 'tab' || role === 'menuitem') return 'button';
  if (tagName === 'a') return 'link';
  if (tagName === 'button') return 'button';
  if (tagName === 'input' && ['button', 'submit', 'reset', 'image'].includes(inputType)) return 'button';
  if (capabilities.typeable) return ref.editableKind === 'contenteditable' ? 'editable' : 'input';
  if (capabilities.selectable) return 'select';
  if (role === 'textbox' || role === 'searchbox') return 'input';

  return 'generic';
}
