import type { V2Ref } from './types';

export type RefFingerprint = string;

export function createRefFingerprint(ref: V2Ref): RefFingerprint {
  return stableHash([
    'hard',
    normalize(ref.targetId),
    normalize(String(ref.backendNodeId ?? '')),
    normalize(ref.selectorCandidates[0] ?? ''),
    normalize(ref.role ?? ''),
    normalize(ref.name ?? ''),
    normalize(ref.text ?? ''),
    normalize(ref.tagName ?? ''),
    normalize(ref.inputType ?? ''),
    normalize(ref.editableKind ?? ''),
  ].join('|'));
}

export function createSoftRefFingerprint(ref: V2Ref): RefFingerprint {
  return stableHash([
    'soft',
    normalize(ref.role ?? ''),
    normalize(ref.name ?? ''),
    normalize(ref.text ?? ''),
    normalize(ref.actionability),
    normalize(ref.tagName ?? ''),
    normalize(ref.inputType ?? ''),
    normalize(ref.editableKind ?? ''),
  ].join('|'));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `rf_${(hash >>> 0).toString(36)}`;
}
