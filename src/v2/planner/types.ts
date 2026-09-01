import type { TransitionClass, TransitionEvidence, TransitionStrength, V2ToolResult } from '../runtime/types';
import type { SerializedProjection } from '../brain1/projectionTypes';
import type { ContinuityGraphSnapshot } from '../graph/types';
import type { TraceManifest, TraceStep } from '../trace/types';
import type { DeadStateEvidence } from '../runtime/DeadStateDetector';
import type { FailureEvidence } from '../runtime/FailureClassifier';
import type { RuntimeUncertainty } from '../runtime/UncertaintySignals';
import type { PlannerRecoveryState } from '../runtime/RecoveryState';
import type {
  PlannerWorkingSet,
  PlannerWorkingSetDiagnostics,
  PlannerWorkingSetOptions,
} from './workingSetTypes';
import type { ProjectionSizeDiagnostics } from './ProjectionSizeDiagnostics';

export type PlannerOutputTool =
  | 'click'
  | 'type'
  | 'navigate'
  | 'scroll'
  | 'wait'
  | 'press'
  | 'get'
  | 'close'
  | 'select'
  | 'search_page'
  | 'find_elements'
  | 'count_elements'
  | 'inspect_region';

export type PlannerConfidence = 'high' | 'medium' | 'low';
export type PlannerEscalation = 'user_needed' | 'captcha' | 'dead_end';
export type PlannerPressKey = 'Enter' | 'Escape' | 'Tab' | 'ArrowDown' | 'ArrowUp';
export type PlannerUncertaintyLevel = 'none' | 'low' | 'medium' | 'high';
export type PlannerInputVersion = 'v2.planner_input.v1' | 'v2.planner_input.v2';

export interface PlannerInputComposerInput {
  episodeId: string;
  goal: string;
  projection: import('../brain1/projectionTypes').OperationalProjection;
  graphSnapshot?: ContinuityGraphSnapshot;
  transitionEvidence?: TransitionEvidence;
  lastResult?: V2ToolResult;
  trace?: TraceManifest | TraceStep[];
  maxLineageSteps?: number;
  failureEvidence?: FailureEvidence[];
  deadStateEvidence?: DeadStateEvidence;
  runtimeUncertainty?: RuntimeUncertainty;
  answerFeedback?: PlannerAnswerFeedback;
  evidenceCoverage?: PlannerEvidenceCoverage;
  evidenceSnapshot?: PlannerEvidenceSnapshot;
  workingSetOptions?: PlannerWorkingSetOptions;
}

export interface PlannerInput {
  version: PlannerInputVersion;
  episodeId: string;
  goal: string;
  current: SerializedProjection;
  workingSet?: PlannerWorkingSet;
  workingSetDiagnostics?: PlannerWorkingSetDiagnostics;
  continuity?: PlannerContinuitySummary;
  transition?: PlannerTransitionSummary;
  lastResult?: PlannerLastResultSummary;
  failures?: PlannerFailureSummary[];
  deadState?: PlannerDeadStateSummary;
  recovery?: PlannerRecoveryState;
  answerFeedback?: PlannerAnswerFeedback;
  evidenceCoverage?: PlannerEvidenceCoverage;
  taskProgress?: PlannerTaskProgress;
  evidenceSnapshot?: PlannerEvidenceSnapshot;
  uncertainty: PlannerUncertainty;
  lineage?: CompressedLineage;
  sizeDiagnostics?: ProjectionSizeDiagnostics;
}

export type PlannerTaskProgressItemStatus = 'pending' | 'observed' | 'applied' | 'conflicting';
export type PlannerTaskProgressState = 'unknown' | 'incomplete' | 'ready' | 'conflicting';

export interface PlannerTaskProgressItem {
  key: string;
  requested: string;
  status: PlannerTaskProgressItemStatus;
  evidence?: string[];
}

/** Advisory state for explicit operational constraints found in the user goal. */
export interface PlannerTaskProgress {
  status: PlannerTaskProgressState;
  items: PlannerTaskProgressItem[];
}

export interface PlannerAnswerFeedback {
  previousAnswer: string;
  missingDetails: string[];
  instruction: string;
}

export type PlannerEvidenceCoverageKey =
  | 'pronunciation'
  | 'definition'
  | 'concrete_basic_information'
  | 'ranking_evidence';
export type PlannerEvidenceCoverageStatus = 'proven' | 'missing' | 'uncertain' | 'conflicting';
export type PlannerEvidenceCoverageState = 'ready' | 'incomplete' | 'uncertain';

export interface PlannerEvidenceCoverageRequirement {
  key: PlannerEvidenceCoverageKey;
  status: PlannerEvidenceCoverageStatus;
  supportingReadIndexes: number[];
}

export interface PlannerEvidenceCoverage {
  contractKind: string;
  status: PlannerEvidenceCoverageState;
  readCount: number;
  requirements: PlannerEvidenceCoverageRequirement[];
}

/** Bounded, relation-preserving facts extracted from the evidence ledger. */
export interface PlannerEvidenceSnapshot {
  activeSort?: {
    dimension: 'stars' | 'date' | 'price' | 'rating' | 'relevance';
    direction: 'asc' | 'desc';
    source: 'url_query' | 'active_control' | 'action_lineage';
  };
  cards: PlannerEvidenceSnapshotCard[];
}

export interface PlannerEvidenceSnapshotCard {
  position: number;
  entity?: string;
  provenRank?: number;
  metrics: {
    stars?: number;
    rating?: number;
    reviewCount?: number;
    price?: number;
    citations?: number;
  };
  temporal?: string[];
  refIds: string[];
}

export interface PlannerContinuitySummary {
  snapshotId: string;
  observationId?: string;
  generationId?: number;
  url?: string;
  refCount: number;
  presentRefCount: number;
  regionCount: number;
  transitionCount: number;
  latestTransition?: {
    transitionId: string;
    transitionClass: TransitionClass;
    strength: TransitionStrength;
  };
}

export interface PlannerTransitionSummary {
  beforeObservationId: string;
  afterObservationId: string;
  transitionClass: TransitionClass;
  strength: TransitionStrength;
  generationChanged: boolean;
  urlChanged: boolean;
  refChangeCounts: {
    appeared: number;
    disappeared: number;
    weakened: number;
    preserved: number;
  };
  notes: string[];
}

export interface PlannerLastResultSummary {
  success: boolean;
  kind: string;
  traceStepId: string;
  targetRef?: string;
  valuePreview?: string;
  error?: {
    code: string;
    retryable: boolean;
    diagnostics?: Record<string, unknown>;
  };
  evidence?: {
    transitionClass: TransitionClass;
    strength: TransitionStrength;
  };
}

export interface PlannerUncertainty {
  level: PlannerUncertaintyLevel;
  signals: string[];
}

export interface PlannerFailureSummary {
  failureId: string;
  kind: string;
  category: string;
  severity: 'info' | 'warning' | 'critical';
  persistence: 'transient' | 'persistent' | 'unknown';
  retryable: boolean;
  observationId?: string;
  targetRef?: string;
  signals: string[];
}

export interface PlannerDeadStateSummary {
  deadState: true;
  evidenceId: string;
  observationId: string;
  severity: 'warning' | 'critical';
  reasons: string[];
  failureKinds: string[];
  signals: string[];
}

export interface CompressedLineage {
  totalSteps: number;
  truncated: boolean;
  steps: CompressedLineageStep[];
}

export interface CompressedLineageStep {
  stepId: string;
  index: number;
  kind: string;
  status: string;
  targetRef?: string;
  beforeObservationId?: string;
  afterObservationId?: string;
  errorCode?: string;
  transitionClass?: TransitionClass;
  strength?: TransitionStrength;
}

export interface LineageCompressOptions {
  maxSteps?: number;
}

export interface PlannerOutputStep {
  tool: PlannerOutputTool;
  ref?: string;
  text?: string;
  value?: string;
  url?: string;
  direction?: 'down' | 'up';
  timeout?: number;
  pattern?: string;
  key?: PlannerPressKey;
}

export interface PlannerOutput {
  plan?: PlannerOutputStep[];
  done?: boolean;
  val?: string;
  escalate?: PlannerEscalation;
  reason?: string;
  confidence?: PlannerConfidence;
}

export type PlannerOutputValidationResult =
  | { ok: true; value: PlannerOutput }
  | { ok: false; errors: string[] };

export type PlannerSerializationMode = 'json' | 'prc';

export interface PlannerSerializationConfig {
  /** @default 'json' */
  mode: PlannerSerializationMode;
  /** Omit per-element score tiers in the opt-in PRC representation. */
  prcTierOmitted?: boolean;
  /** Render the compact PRC data-plane layout. */
  compactDataPlane?: boolean;
}
