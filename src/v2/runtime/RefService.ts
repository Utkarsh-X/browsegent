import type { BrowserObservation, V2Ref } from './types';
import { createRefFingerprint, createSoftRefFingerprint } from './refFingerprint';
import type { RefComparison, RefResolution } from './refResolution';

interface StoredRef {
  refId: string;
  hardFingerprint: string;
  softFingerprint: string;
  ref: V2Ref;
}

export class RefService {
  private nextRefId = 1;
  private storedRefs: StoredRef[] = [];

  assign(observation: BrowserObservation): BrowserObservation {
    const assignedRefs = observation.refs.map(ref => this.assignOne(ref, observation.generationId));

    this.storedRefs = assignedRefs.map(ref => ({
      refId: ref.refId,
      hardFingerprint: createRefFingerprint(ref),
      softFingerprint: createSoftRefFingerprint(ref),
      ref,
    }));

    return {
      ...observation,
      refs: assignedRefs,
      stats: {
        ...observation.stats,
        refCount: assignedRefs.length,
        visibleRefCount: assignedRefs.filter(ref => ref.visibility === 'visible').length,
      },
    };
  }

  resolve(refId: string, current: BrowserObservation): RefResolution {
    const ref = current.refs.find(candidate => candidate.refId === refId);
    if (!ref) {
      return {
        state: 'invalid',
        confidence: 0,
        reason: 'ref_not_present_in_current_observation',
      };
    }

    if (ref.state !== 'live') {
      return {
        ref,
        state: ref.state,
        confidence: ref.continuityConfidence,
        reason: ref.invalidationReason,
      };
    }

    if (ref.continuityConfidence < 0.7) {
      return {
        ref,
        state: 'weakened',
        confidence: ref.continuityConfidence,
        reason: 'continuity_confidence_below_execution_threshold',
      };
    }

    return {
      ref,
      state: 'live',
      confidence: ref.continuityConfidence,
    };
  }

  compare(before: BrowserObservation, after: BrowserObservation): RefComparison {
    const beforeIds = new Set(before.refs.map(ref => ref.refId));
    const afterIds = new Set(after.refs.map(ref => ref.refId));

    return {
      appeared: after.refs.filter(ref => !beforeIds.has(ref.refId)).map(ref => ref.refId),
      disappeared: before.refs.filter(ref => !afterIds.has(ref.refId)).map(ref => ref.refId),
      weakened: after.refs.filter(ref => beforeIds.has(ref.refId) && ref.state === 'weakened').map(ref => ref.refId),
      preserved: after.refs.filter(ref => beforeIds.has(ref.refId) && ref.state !== 'weakened').map(ref => ref.refId),
    };
  }

  private assignOne(ref: V2Ref, generationId: number): V2Ref {
    const hardFingerprint = createRefFingerprint(ref);
    const hardMatch = this.storedRefs.find(stored => stored.hardFingerprint === hardFingerprint);
    if (hardMatch) {
      return {
        ...ref,
        refId: hardMatch.refId,
        generationId,
        continuityConfidence: 1,
        state: 'live',
        invalidationReason: undefined,
      };
    }

    const softFingerprint = createSoftRefFingerprint(ref);
    const softMatches = this.storedRefs.filter(stored => stored.softFingerprint === softFingerprint);
    if (softMatches.length === 1) {
      return {
        ...ref,
        refId: softMatches[0].refId,
        generationId,
        continuityConfidence: Math.min(ref.continuityConfidence, 0.55),
        state: 'weakened',
        invalidationReason: 'soft_identity_match_requires_verification',
      };
    }

    return {
      ...ref,
      refId: `v2ref_${this.nextRefId++}`,
      generationId,
      continuityConfidence: Math.min(ref.continuityConfidence, 1),
      state: 'live',
      invalidationReason: undefined,
    };
  }
}
