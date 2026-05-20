import type {
  ActionabilityState,
  RefState,
  TransitionClass,
  TransitionEvidence,
  TransitionStrength,
  VisibilityState,
} from '../runtime/types';

export interface ContinuityGraphOptions {
  maxTransitions?: number;
}

export interface ContinuityGraphRefNode {
  refId: string;
  targetId: string;
  generationId: number;
  regionId?: string;
  visibility: VisibilityState;
  actionability: ActionabilityState;
  state: RefState;
  continuityConfidence: number;
  present: boolean;
  firstSeenObservationId: string;
  lastSeenObservationId: string;
  lastChangedTransitionId?: string;
}

export interface ContinuityGraphRegion {
  regionId: string;
  refIds: string[];
  staleRefIds: string[];
}

export interface ContinuityGraphTransition {
  transitionId: string;
  beforeObservationId: string;
  afterObservationId: string;
  transitionClass: TransitionClass;
  strength: TransitionStrength;
  generationChanged: boolean;
  urlChanged: boolean;
  refChanges: TransitionEvidence['refChanges'];
  notes: string[];
}

export interface ContinuityGraphSnapshot {
  snapshotId: string;
  observationId?: string;
  generationId?: number;
  url?: string;
  refs: ContinuityGraphRefNode[];
  regions: ContinuityGraphRegion[];
  transitions: ContinuityGraphTransition[];
  stats: {
    refCount: number;
    presentRefCount: number;
    regionCount: number;
    transitionCount: number;
    maxTransitions: number;
  };
}

export function createTransitionId(evidence: Pick<TransitionEvidence, 'beforeObservationId' | 'afterObservationId'>): string {
  return `transition_${safeIdPart(evidence.beforeObservationId)}_${safeIdPart(evidence.afterObservationId)}`;
}

function safeIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]+/g, '_');
}
