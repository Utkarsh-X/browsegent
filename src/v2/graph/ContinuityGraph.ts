import type { BrowserObservation, TransitionEvidence, V2Ref } from '../runtime/types';
import {
  createTransitionId,
  type ContinuityGraphOptions,
  type ContinuityGraphRefNode,
  type ContinuityGraphRegion,
  type ContinuityGraphSnapshot,
  type ContinuityGraphTransition,
} from './types';

const DEFAULT_MAX_TRANSITIONS = 20;

export class ContinuityGraph {
  private readonly maxTransitions: number;
  private readonly refs = new Map<string, ContinuityGraphRefNode>();
  private readonly transitions: ContinuityGraphTransition[] = [];
  private observationId?: string;
  private generationId?: number;
  private url?: string;

  constructor(options: ContinuityGraphOptions = {}) {
    this.maxTransitions = Math.max(1, options.maxTransitions ?? DEFAULT_MAX_TRANSITIONS);
  }

  applyObservation(observation: BrowserObservation): ContinuityGraphSnapshot {
    this.observationId = observation.observationId;
    this.generationId = observation.generationId;
    this.url = observation.url;

    const currentRefIds = new Set<string>();
    for (const ref of observation.refs) {
      currentRefIds.add(ref.refId);
      this.refs.set(ref.refId, this.toRefNode(ref, observation.observationId));
    }

    for (const [refId, node] of this.refs) {
      if (!currentRefIds.has(refId) && node.present) {
        this.refs.set(refId, {
          ...node,
          present: false,
          state: node.state === 'invalid' ? 'invalid' : 'stale',
        });
      }
    }

    return this.snapshot();
  }

  applyTransition(evidence: TransitionEvidence): ContinuityGraphSnapshot {
    const transitionId = createTransitionId(evidence);
    this.transitions.push({
      transitionId,
      beforeObservationId: evidence.beforeObservationId,
      afterObservationId: evidence.afterObservationId,
      transitionClass: evidence.transitionClass,
      strength: evidence.strength,
      generationChanged: evidence.generationChanged,
      urlChanged: evidence.urlChanged,
      refChanges: evidence.refChanges,
      notes: [...evidence.notes],
    });

    while (this.transitions.length > this.maxTransitions) {
      this.transitions.shift();
    }

    this.markChangedRefs(transitionId, evidence);
    return this.snapshot();
  }

  snapshot(): ContinuityGraphSnapshot {
    const refs = [...this.refs.values()].sort((left, right) => left.refId.localeCompare(right.refId));
    const regions = buildRegions(refs);

    return {
      snapshotId: `graph_${this.observationId ?? 'empty'}_${this.transitions.length}`,
      observationId: this.observationId,
      generationId: this.generationId,
      url: this.url,
      refs,
      regions,
      transitions: this.transitions.map(transition => ({
        ...transition,
        refChanges: {
          appeared: [...transition.refChanges.appeared],
          disappeared: [...transition.refChanges.disappeared],
          weakened: [...transition.refChanges.weakened],
          preserved: [...transition.refChanges.preserved],
        },
        notes: [...transition.notes],
      })),
      stats: {
        refCount: refs.length,
        presentRefCount: refs.filter(ref => ref.present).length,
        regionCount: regions.length,
        transitionCount: this.transitions.length,
        maxTransitions: this.maxTransitions,
      },
    };
  }

  private toRefNode(ref: V2Ref, observationId: string): ContinuityGraphRefNode {
    const existing = this.refs.get(ref.refId);

    return {
      refId: ref.refId,
      targetId: ref.targetId,
      generationId: ref.generationId,
      regionId: ref.regionId,
      visibility: ref.visibility,
      actionability: ref.actionability,
      state: ref.state,
      continuityConfidence: ref.continuityConfidence,
      present: true,
      firstSeenObservationId: existing?.firstSeenObservationId ?? observationId,
      lastSeenObservationId: observationId,
      lastChangedTransitionId: existing?.lastChangedTransitionId,
    };
  }

  private markChangedRefs(transitionId: string, evidence: TransitionEvidence): void {
    for (const refId of [
      ...evidence.refChanges.appeared,
      ...evidence.refChanges.disappeared,
      ...evidence.refChanges.weakened,
    ]) {
      const node = this.refs.get(refId);
      if (!node) continue;

      this.refs.set(refId, {
        ...node,
        present: evidence.refChanges.disappeared.includes(refId) ? false : node.present,
        state: evidence.refChanges.disappeared.includes(refId)
          ? 'stale'
          : evidence.refChanges.weakened.includes(refId)
            ? 'weakened'
            : node.state,
        lastChangedTransitionId: transitionId,
      });
    }

    for (const note of evidence.notes) {
      if (!note.startsWith('ref_changed:')) continue;
      const refId = note.slice('ref_changed:'.length);
      const node = this.refs.get(refId);
      if (!node) continue;

      this.refs.set(refId, {
        ...node,
        lastChangedTransitionId: transitionId,
      });
    }
  }
}

function buildRegions(refs: ContinuityGraphRefNode[]): ContinuityGraphRegion[] {
  const groups = new Map<string, { present: string[]; stale: string[] }>();

  for (const ref of refs) {
    if (!ref.regionId) continue;
    const group = groups.get(ref.regionId) ?? { present: [], stale: [] };
    if (ref.present) {
      group.present.push(ref.refId);
    } else {
      group.stale.push(ref.refId);
    }
    groups.set(ref.regionId, group);
  }

  return [...groups.entries()]
    .map(([regionId, group]) => ({
      regionId,
      refIds: group.present.sort((left, right) => left.localeCompare(right)),
      staleRefIds: group.stale.sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => left.regionId.localeCompare(right.regionId));
}
