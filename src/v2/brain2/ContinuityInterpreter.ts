import type { BrowserObservation, Rect, TransitionEvidence, V2Ref } from '../runtime/types';
import { classifyTransition } from './transitionClassifier';
import { calculateProgressStrength, type RefChangeSummary } from './progressEvidence';

export class ContinuityInterpreter {
  interpret(before: BrowserObservation, after: BrowserObservation): TransitionEvidence {
    const beforeById = new Map(before.refs.map(ref => [ref.refId, ref]));
    const afterById = new Map(after.refs.map(ref => [ref.refId, ref]));
    const refChanges = summarizeRefChanges(before, after, beforeById);
    const changedRefs = after.refs
      .filter(ref => {
        const previous = beforeById.get(ref.refId);
        return previous !== undefined && hasStructuralRefChange(previous, ref);
      })
      .map(ref => ref.refId);
    const boxChangedRefs = after.refs
      .filter(ref => {
        const previous = beforeById.get(ref.refId);
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
  before: BrowserObservation,
  after: BrowserObservation,
  beforeById: Map<string, V2Ref>,
): RefChangeSummary {
  const afterById = new Map(after.refs.map(ref => [ref.refId, ref]));

  return {
    appeared: after.refs.filter(ref => !beforeById.has(ref.refId)).map(ref => ref.refId),
    disappeared: before.refs.filter(ref => !afterById.has(ref.refId)).map(ref => ref.refId),
    weakened: after.refs
      .filter(ref => beforeById.has(ref.refId) && ref.state === 'weakened')
      .map(ref => ref.refId),
    preserved: after.refs
      .filter(ref => beforeById.has(ref.refId) && ref.state !== 'weakened')
      .map(ref => ref.refId),
  };
}

function hasStructuralRefChange(before: V2Ref, after: V2Ref): boolean {
  return before.targetId !== after.targetId
    || before.role !== after.role
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
