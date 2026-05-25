import type { BrowserObservation, RuntimeWarning, TransitionEvidence, V2RuntimeMode, V2ToolResult } from '../runtime/types';
import type { ContinuityGraphSnapshot } from '../graph/types';
import type { FailureEvidence } from '../runtime/FailureClassifier';

export type TraceArtifactKind =
  | 'trace'
  | 'observation'
  | 'screenshot'
  | 'transition'
  | 'graph'
  | 'failure'
  | 'planner_input'
  | 'planner_output';
export type TraceStepStatus = 'started' | 'completed' | 'failed';

export type TraceJsonPrimitive = string | number | boolean | null;
export type TraceJsonValue = TraceJsonPrimitive | TraceJsonValue[] | { [key: string]: TraceJsonValue };

export interface TraceArtifact {
  kind: TraceArtifactKind;
  id: string;
  path: string;
}

export interface TraceManifest {
  runId: string;
  runtimeMode: V2RuntimeMode;
  startTime: number;
  steps: TraceStep[];
  artifacts: {
    trace: TraceArtifact;
    observations: TraceArtifact[];
    transitions: TraceArtifact[];
    graph: TraceArtifact[];
    planner: TraceArtifact[];
    failures?: TraceArtifact[];
    screenshots: TraceArtifact[];
  };
}

export interface TraceStoreOptions {
  runId: string;
  runtimeMode: V2RuntimeMode;
  traceDir: string;
  startTime?: number;
}

export interface TraceActionStartInput {
  kind: string;
  targetRef?: string;
  beforeObservationId?: string;
  timestamp?: number;
  input?: TraceJsonValue;
  preconditions?: TraceJsonValue;
  warnings?: RuntimeWarning[];
}

export interface TraceActionEndOptions {
  afterObservationId?: string;
  timestamp?: number;
  warnings?: RuntimeWarning[];
}

export interface TraceStep {
  stepId: string;
  index: number;
  kind: string;
  status: TraceStepStatus;
  startedAt: number;
  endedAt?: number;
  targetRef?: string;
  beforeObservationId?: string;
  afterObservationId?: string;
  input?: TraceJsonValue;
  preconditions?: TraceJsonValue;
  warnings: RuntimeWarning[];
  result?: TraceJsonValue;
}

export interface TraceObservationRecord {
  artifact: TraceArtifact;
  observation: BrowserObservation;
}

export interface TraceGraphRecord {
  artifact: TraceArtifact;
  snapshot: ContinuityGraphSnapshot;
}

export interface TraceTransitionRecord {
  artifact: TraceArtifact;
  evidence: TransitionEvidence;
}

export interface TracePlannerRecord {
  artifact: TraceArtifact;
  payload: TraceJsonValue;
}

export interface TraceFailureRecord {
  artifact: TraceArtifact;
  failure: FailureEvidence;
}

export type TraceToolResult = V2ToolResult<TraceJsonValue>;
