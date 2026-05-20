import type { BrowserObservation, TransitionEvidence, TransitionStrength, V2Ref } from './types';

export class TransitionService {
  compare(before: BrowserObservation, after: BrowserObservation): TransitionEvidence {
    const beforeById = new Map(before.refs.map(ref => [ref.refId, ref]));
    const afterById = new Map(after.refs.map(ref => [ref.refId, ref]));
    const appeared = after.refs.filter(ref => !beforeById.has(ref.refId)).map(ref => ref.refId);
    const disappeared = before.refs.filter(ref => !afterById.has(ref.refId)).map(ref => ref.refId);
    const weakened = after.refs
      .filter(ref => beforeById.has(ref.refId) && ref.state === 'weakened')
      .map(ref => ref.refId);
    const preserved = after.refs
      .filter(ref => beforeById.has(ref.refId) && ref.state !== 'weakened')
      .map(ref => ref.refId);
    const changedPreserved = after.refs.filter(ref => {
      const previous = beforeById.get(ref.refId);
      return previous !== undefined && hasOperationalChange(previous, ref);
    });
    const generationChanged = before.generationId !== after.generationId;
    const urlChanged = before.url !== after.url;
    const hasLocalStructureChange = appeared.length > 0 || disappeared.length > 0 || weakened.length > 0 || changedPreserved.length > 0;
    const transitionClass = urlChanged || generationChanged
      ? 'structural_macrostate'
      : hasLocalStructureChange
        ? 'structural_local'
        : 'microstate';
    const strength: TransitionStrength = urlChanged || generationChanged
      ? 'strong'
      : hasLocalStructureChange
        ? 'moderate'
        : 'none';

    return {
      beforeObservationId: before.observationId,
      afterObservationId: after.observationId,
      transitionClass,
      strength,
      generationChanged,
      urlChanged,
      refChanges: {
        appeared,
        disappeared,
        weakened,
        preserved,
      },
      notes: changedPreserved.map(ref => `ref_changed:${ref.refId}`),
    };
  }
}

function hasOperationalChange(before: V2Ref, after: V2Ref): boolean {
  return before.visibility !== after.visibility
    || before.actionability !== after.actionability
    || before.name !== after.name
    || before.text !== after.text;
}
