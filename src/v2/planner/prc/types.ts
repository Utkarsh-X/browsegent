import type {
  PlannerAnswerFeedback,
  PlannerContinuitySummary,
  PlannerDeadStateSummary,
  PlannerFailureSummary,
  PlannerLastResultSummary,
  PlannerTransitionSummary,
  PlannerUncertainty,
  CompressedLineage,
} from '../types';
import type { PlannerRecoveryState } from '../../runtime/RecoveryState';
import type {
  PlannerActionSurface,
  PlannerChangedRefsSummary,
  PlannerQuarantinedAction,
  PlannerWorkingSetEvidence,
  PlannerWorkingSetRegionSummary,
  WorkingSetDropReason,
  WorkingSetIncludeReason,
  WorkingSetMode,
} from '../workingSetTypes';

export type PlannerElementLane = 'interaction' | 'readable' | 'navigation' | 'mixed';
export type PlannerScoreTier = 'top' | 'high' | 'mid' | 'low';

export interface PlannerElementIR {
  refId: string;
  kind: string;
  role?: string;
  /** Guaranteed non-empty by compiler: falls back to text, then refId */
  name: string;
  text?: string;
  ariaAutocomplete?: string;
  ariaHasPopup?: string;
  value?: string;
  placeholder?: string;
  lane: PlannerElementLane;
  rank?: number;
  scoreTier: PlannerScoreTier;
  score: number;
  regionId?: string;
  selectOptions?: string[];
  anomalies: string[];
  failure?: { kind: string; count: number; retryable: boolean; persistence: 'transient' | 'persistent' | 'unknown' };
  tools?: string[];
}

export interface PlannerRegionIR {
  regionId: string;
  label: string;
  kind: string;
  elements: PlannerElementIR[];
  omittedCount: number;
  totalCount: number;
}

export interface PlannerSurfaceIR {
  groups: PlannerRegionIR[];
  remainder: PlannerElementIR[];
  inputRefCount: number;
  surfaceRefCount: number;
}

export interface ExecutionContextIR {
  goal: string;
  page?: { title: string; url: string };
  focus?: { refId: string; reason: string };
  continuity?: PlannerContinuitySummary;
  transition?: PlannerTransitionSummary;
  lastResult?: PlannerLastResultSummary;
  failures: PlannerFailureSummary[];
  deadState?: PlannerDeadStateSummary;
  recovery?: PlannerRecoveryState;
  answerFeedback?: PlannerAnswerFeedback;
  evidenceCoverage?: import('../types').PlannerEvidenceCoverage;
  evidenceSnapshot?: import('../types').PlannerEvidenceSnapshot;
  uncertainty: PlannerUncertainty;
  lineage?: CompressedLineage;
}

export interface WorkingSetIR {
  mode?: WorkingSetMode;
  modeReason?: string;
  primary: Array<{ refId: string; reasons: WorkingSetIncludeReason[] }>;
  secondary: Array<{ refId: string; reasons: WorkingSetIncludeReason[] }>;
  navigation: Array<{ refId: string; reasons: WorkingSetIncludeReason[] }>;
  failed: Array<{ refId: string; reasons: WorkingSetIncludeReason[] }>;
  readableEvidence: PlannerWorkingSetEvidence[];
  changedRefs: PlannerChangedRefsSummary;
  quarantinedActions: PlannerQuarantinedAction[];
  regionSummaries: PlannerWorkingSetRegionSummary[];
  /** Operational action surface — available for working-set reasoning */
  actionSurface?: PlannerActionSurface;
  omitted?: { observed: number; selected: number; dropped: number; byReason: Partial<Record<WorkingSetDropReason, number>> };
}

export interface DecisionSignalsIR {
  /** Rendered in DECISION SIGNALS output block (separate from WORKING SET) */
  actionSurface?: PlannerActionSurface;
  suppressed?: { count: number; byReason: Partial<Record<WorkingSetDropReason, number>> };
}

export interface PlannerRepresentationStats {
  inputRefCount: number;
  surfaceRefCount: number;
  omittedRegionMembers: number;
  failureAnnotations: number;
  anomalyCount: number;
}

export interface PlannerRepresentationIR {
  execution: ExecutionContextIR;
  surface: PlannerSurfaceIR;
  workingSet?: WorkingSetIR;
  decisionSignals?: DecisionSignalsIR;
  stats: PlannerRepresentationStats;
}
