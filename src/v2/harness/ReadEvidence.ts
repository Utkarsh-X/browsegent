import type { V2Ref } from '../runtime/types';

export interface ReadEvidenceOptions {
  maxNearbyRefs?: number;
  maxCharacters?: number;
  verticalWindowPx?: number;
}

const DEFAULT_OPTIONS: Required<ReadEvidenceOptions> = {
  maxNearbyRefs: 12,
  maxCharacters: 1_800,
  verticalWindowPx: 320,
};

/**
 * Preserve useful local text when a read targets a tiny structural marker.
 * This is deliberately bounded and does not attempt to reconstruct the DOM.
 */
export function buildBoundedReadEvidenceText(
  target: V2Ref,
  refs: readonly V2Ref[],
  options: ReadEvidenceOptions = {},
): string {
  const limits = { ...DEFAULT_OPTIONS, ...options };
  const ownText = readText(target);
  if (!shouldEnrichTarget(target, ownText)) {
    return compactText(ownText, limits.maxCharacters);
  }

  const targetBox = target.box;
  if (!targetBox) return compactText(ownText, limits.maxCharacters);

  const targetBottom = targetBox.y + targetBox.height;
  const nearby = refs
    .filter(candidate => candidate.refId !== target.refId)
    .filter(candidate => candidate.visibility === 'visible' && candidate.state !== 'stale')
    .filter(candidate => sameFrame(target, candidate))
    .filter(candidate => Boolean(readText(candidate)))
    .filter(candidate => {
      if (!candidate.box) return false;
      return candidate.box.y >= targetBox.y - 8
        && candidate.box.y <= targetBottom + limits.verticalWindowPx;
    })
    .sort((left, right) => {
      const leftBox = left.box!;
      const rightBox = right.box!;
      if (leftBox.y !== rightBox.y) return leftBox.y - rightBox.y;
      if (leftBox.x !== rightBox.x) return leftBox.x - rightBox.x;
      return left.refId.localeCompare(right.refId);
    })
    .slice(0, limits.maxNearbyRefs)
    .map(candidate => readText(candidate));

  return compactText(joinUniqueText([ownText, ...nearby]), limits.maxCharacters);
}

function shouldEnrichTarget(target: V2Ref, ownText: string): boolean {
  if (target.role || !target.box || !ownText) return false;
  return target.box.width <= 4 || target.box.height <= 4;
}

function sameFrame(left: V2Ref, right: V2Ref): boolean {
  return !left.frameId || !right.frameId || left.frameId === right.frameId;
}

function readText(ref: V2Ref): string {
  const name = normalizeText(ref.name);
  const text = normalizeText(ref.text);
  if (!name) return text;
  if (!text) return name;

  // An aria name that contains the visible caption is the more useful
  // identity; avoid repeating a generic button label in read evidence.
  if (ref.role && name.toLowerCase().includes(text.toLowerCase())) return name;
  return joinUniqueText([name, text]);
}

function joinUniqueText(values: Array<string | undefined>): string {
  const unique: string[] = [];
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized) continue;
    if (unique.some(existing => existing.toLowerCase() === normalized.toLowerCase())) continue;
    unique.push(normalized);
  }
  return unique.join(' ');
}

function normalizeText(value: string | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

function compactText(value: string, maxCharacters: number): string {
  if (value.length <= maxCharacters) return value;
  return `${value.slice(0, Math.max(0, maxCharacters - 3))}...`;
}
