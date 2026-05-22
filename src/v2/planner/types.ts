import type { TransitionClass, TransitionEvidence, TransitionStrength, V2ToolResult } from '../runtime/types';
import type { SerializedProjection } from '../brain1/projectionTypes';
import type { ContinuityGraphSnapshot } from '../graph/types';
import type { TraceManifest } from '../trace/types';
import type { DeadStateEvidence } from '../runtime/DeadStateDetector';
import type { FailureEvidence } from '../runtime/FailureClassifier';
import type { RuntimeUncertainty } from '../runtime/UncertaintySignals';

export type PlannerOutputTool =
  | 'click'
  | 'type'
  | 'navigate'
  | 'scroll'
  | 'wait'
  | 'get'
  | 'close'
  | 'select'
  | 'search_page'
  | 'find_elements'
  | 'count_elements'
  | 'inspect_region';

export type PlannerConfidence = 'high' | 'medium' | 'low';
export type PlannerEscalation = 'user_needed' | 'captcha' | 'dead_end';
export type PlannerUncertaintyLevel = 'none' | 'low' | 'medium' | 'high';

export interface PlannerInputComposerInput {
  episodeId: string;
  goal: string;
  projection: import('../brain1/projectionTypes').OperationalProjection;
  graphSnapshot?: ContinuityGraphSnapshot;
  transitionEvidence?: TransitionEvidence;
  lastResult?: V2ToolResult;
  trace?: TraceManifest;
  maxLineageSteps?: number;
  failureEvidence?: FailureEvidence[];
  deadStateEvidence?: DeadStateEvidence;
  runtimeUncertainty?: RuntimeUncertainty;
}

export interface PlannerInput {
  version: 'v2.planner_input.v1';
  episodeId: string;
  goal: string;
  current: SerializedProjection;
  continuity?: PlannerContinuitySummary;
  transition?: PlannerTransitionSummary;
  lastResult?: PlannerLastResultSummary;
  failures?: PlannerFailureSummary[];
  deadState?: PlannerDeadStateSummary;
  uncertainty: PlannerUncertainty;
  lineage?: CompressedLineage;
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
