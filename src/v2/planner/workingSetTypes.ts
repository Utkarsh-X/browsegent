import type {
  ProjectionItemKind,
  SerializedProjectionRef,
} from '../brain1/projectionTypes';

export type WorkingSetMode = 'explore' | 'act' | 'verify' | 'recover' | 'extract' | 'done_candidate';

export type WorkingSetIncludeReason =
  | 'visible_ready'
  | 'goal_keyword_match'
  | 'role_relevant_to_goal'
  | 'near_focus'
  | 'recently_appeared'
  | 'recently_changed'
  | 'last_target'
  | 'last_success'
  | 'last_failure'
  | 'dead_state_evidence'
  | 'answer_candidate'
  | 'navigation_candidate'
  | 'form_candidate'
  | 'region_representative';

export type WorkingSetDropReason =
  | 'hidden_low_value'
  | 'offscreen_low_value'
  | 'generic_low_value'
  | 'duplicate_region_member'
  | 'navigation_overflow'
  | 'readable_overflow'
  | 'stale_unrelated'
  | 'low_confidence_unrelated'
  | 'token_budget_exceeded';

export interface PlannerWorkingSetOptions {
  maxPrimaryRefs?: number;
  maxSecondaryRefs?: number;
  maxReadableEvidence?: number;
  maxNavigationRefs?: number;
  maxRegionSummaries?: number;
  maxTextLengthPerRef?: number;
  maxChangedRefs?: number;
}

export interface PlannerWorkingSetRef {
  refId: string;
  kind: ProjectionItemKind;
  role?: string;
  name?: string;
  text?: string;
  score: number;
  reasons: WorkingSetIncludeReason[];
}

export interface PlannerWorkingSetEvidence {
  refId: string;
  text: string;
  reasons: WorkingSetIncludeReason[];
}

export interface PlannerWorkingSetRegionSummary {
  regionId: string;
  label: string;
  representativeRefs: string[];
  omittedRefCount: number;
}

export interface PlannerWorkingSetOmittedSummary {
  observedRefCount: number;
  selectedRefCount: number;
  droppedRefCount: number;
  droppedByReason: Partial<Record<WorkingSetDropReason, number>>;
}

export interface PlannerActionSurface {
  clickableRefs: string[];
  typeableRefs: string[];
  selectableRefs: string[];
  readableRefs: string[];
  ambiguousRefs: string[];
}

export interface PlannerChangedRefsSummary {
  appearedCount: number;
  weakenedCount: number;
  preservedCount: number;
  topRefs: PlannerWorkingSetRef[];
  omittedCount: number;
}

export interface PlannerWorkingSet {
  mode: WorkingSetMode;
  modeReason: string;
  primaryRefs: PlannerWorkingSetRef[];
  secondaryRefs: PlannerWorkingSetRef[];
  readableEvidence: PlannerWorkingSetEvidence[];
  navigationRefs: PlannerWorkingSetRef[];
  actionSurface: PlannerActionSurface;
  changedRefs: PlannerChangedRefsSummary;
  failedRefs: PlannerWorkingSetRef[];
  regionSummaries: PlannerWorkingSetRegionSummary[];
  omitted: PlannerWorkingSetOmittedSummary;
}

export interface PlannerWorkingSetDiagnostics {
  observedRefCount: number;
  selectedRefCount: number;
  droppedRefCount: number;
  selectedByReason: Partial<Record<WorkingSetIncludeReason, number>>;
  droppedByReason: Partial<Record<WorkingSetDropReason, number>>;
  maxPrimaryRefs: number;
  maxSecondaryRefs: number;
  maxReadableEvidence: number;
  maxNavigationRefs: number;
  maxRegionSummaries: number;
}

export interface PlannerWorkingSetSelection {
  current: import('../brain1/projectionTypes').SerializedProjection;
  workingSet: PlannerWorkingSet;
  diagnostics: PlannerWorkingSetDiagnostics;
  selectedRefIds: string[];
}

export type WorkingSetSerializedRef = SerializedProjectionRef;
