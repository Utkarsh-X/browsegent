import type { BrowserObservation, Rect, TransitionEvidence, V2Ref } from '../runtime/types';
import { classifyTransition } from './transitionClassifier';
import { calculateProgressStrength, type RefChangeSummary } from './progressEvidence';

export class ContinuityInterpreter {
  interpret(before: BrowserObservation, after: BrowserObservation): TransitionEvidence {
    const matches = matchRefs(before, after);
    const refChanges = summarizeRefChanges(matches);
    const changedRefs = after.refs
      .filter(ref => {
        const previous = matches.matched.get(ref.refId);
        return previous !== undefined && hasStructuralRefChange(previous, ref);
      })
      .map(ref => ref.refId);
    const boxChangedRefs = after.refs
      .filter(ref => {
        const previous = matches.matched.get(ref.refId);
        return previous !== undefined && hasBoxChange(previous.box, ref.box);
      })
      .map(ref => ref.refId);
    const transitionClass = classifyTransition({
      before,
      after,
      refChanges,
      changedRefs,
    });
    const strength = calculateProgressStrength({
      transitionClass,
      refChanges,
      changedRefs,
      boxChangedRefs,
    });

    return {
      beforeObservationId: before.observationId,
      afterObservationId: after.observationId,
      transitionClass,
      strength,
      generationChanged: before.generationId !== after.generationId,
      urlChanged: before.url !== after.url,
      refChanges,
      notes: buildNotes(before, after, refChanges, changedRefs, boxChangedRefs),
    };
  }
}

function summarizeRefChanges(
  matches: RefMatches,
): RefChangeSummary {
  return {
    appeared: matches.appeared.map(ref => ref.refId),
    disappeared: matches.disappeared.map(ref => ref.refId),
    weakened: [...matches.matchedAfter.entries()]
      .filter(([refId, current]) =>
        current.state === 'weakened'
        && matches.matched.get(refId)?.state !== 'weakened',
      )
      .map(([refId]) => refId),
    preserved: [...matches.matched.keys()]
      .filter(refId => {
        const current = matches.matchedAfter.get(refId);
        return current?.state !== 'weakened';
      }),
  };
}

interface RefMatches {
  matched: Map<string, V2Ref>;
  matchedAfter: Map<string, V2Ref>;
  appeared: V2Ref[];
  disappeared: V2Ref[];
}

/**
 * Ref ids are observation-scoped and can be regenerated on every scan. Match
 * by stable substrate identity first so bookkeeping reflects page changes,
 * not the serializer's allocation order.
 */
function matchRefs(before: BrowserObservation, after: BrowserObservation): RefMatches {
  const unmatchedBefore = new Set(before.refs);
  const matched = new Map<string, V2Ref>();
  const matchedAfter = new Map<string, V2Ref>();
  const appeared: V2Ref[] = [];

  for (const current of after.refs) {
    const previous = findMatch(current, unmatchedBefore);
    if (!previous) {
      appeared.push(current);
      continue;
    }

    unmatchedBefore.delete(previous);
    matched.set(current.refId, previous);
    matchedAfter.set(current.refId, current);
  }

  return {
    matched,
    matchedAfter,
    appeared,
    disappeared: [...unmatchedBefore],
  };
}

function findMatch(current: V2Ref, candidates: Set<V2Ref>): V2Ref | undefined {
  if (current.targetId) {
    const stableMatch = [...candidates].find(candidate =>
      candidate.targetId === current.targetId,
    );
    if (stableMatch) return stableMatch;
  }

  // Ref ids are the stable fallback for scans where the substrate regenerated
  // target ids without changing the represented control.
  return [...candidates].find(candidate => candidate.refId === current.refId);
}

function hasStructuralRefChange(before: V2Ref, after: V2Ref): boolean {
  return before.role !== after.role
    || before.name !== after.name
    || before.text !== after.text
    || before.regionId !== after.regionId
    || before.visibility !== after.visibility
    || before.actionability !== after.actionability
    || before.state !== after.state
    || before.continuityConfidence !== after.continuityConfidence;
}

function hasBoxChange(before: Rect | undefined, after: Rect | undefined): boolean {
  if (before === undefined || after === undefined) {
    return before !== after;
  }

  return before.x !== after.x
    || before.y !== after.y
    || before.width !== after.width
    || before.height !== after.height;
}

function buildNotes(
  before: BrowserObservation,
  after: BrowserObservation,
  refChanges: RefChangeSummary,
  changedRefs: string[],
  boxChangedRefs: string[],
): string[] {
  const notes: string[] = [];

  if (before.url !== after.url) {
    notes.push('url_changed');
  }
  if (before.generationId !== after.generationId) {
    notes.push('generation_changed');
  }
  if (refChanges.appeared.length > 0) {
    notes.push(`refs_appeared:${refChanges.appeared.length}`);
  }
  if (refChanges.disappeared.length > 0) {
    notes.push(`refs_disappeared:${refChanges.disappeared.length}`);
  }
  if (refChanges.weakened.length > 0) {
    notes.push(`refs_weakened:${refChanges.weakened.length}`);
  }

  for (const refId of changedRefs) {
    notes.push(`ref_changed:${refId}`);
  }
  for (const refId of boxChangedRefs) {
    notes.push(`box_changed:${refId}`);
  }

  return notes;
}
