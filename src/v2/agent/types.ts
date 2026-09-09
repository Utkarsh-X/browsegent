import type { PlannerInput, PlannerOutput, PlannerSerializationConfig } from '../planner/types';
import type { BrowserObservation } from '../runtime/types';
import type { FailureEvidence } from '../runtime/FailureClassifier';
import type { BrowserSessionOptions } from '../substrate/types';
import type { TraceArtifact, TraceManifest } from '../trace/types';
import type { V2ToolDispatchContext, V2ToolDispatcherLike, V2ToolRuntime } from '../tools/types';
import type { PlannerWorkingSetOptions } from '../planner/workingSetTypes';

export interface V2AgentLoopInput {
  url: string;
  goal: string;
  maxSteps: number;
  model?: string;
  plannerSerialization?: PlannerSerializationConfig;
  workingSetOptions?: PlannerWorkingSetOptions;
}

export interface V2AgentLoopResult {
  success: boolean;
  value: string;
  failureReason?: string;
  /** Advisory contract reasons that fired but were overridden to preserve the answer. */
  advisoryNotes?: string;
  steps: number;
  tracePath?: string;
  metrics: {
    plannerCalls: number;
    inputTokens: number;
    outputTokens: number;
    plannerDurationMs: number;
    toolExecutions: number;
    postActionObservationReuseCount?: number;
    postActionObservationRecaptureCount?: number;
    terminalContinuations?: number;
  };
}

export interface V2PlannerClientLike {
  call(input: {
    plannerInput: PlannerInput;
    model?: string;
    mode?: 'normal' | 'finalization' | 'done_candidate';
    checklistSuffix?: string;
    /** Page-model 2b (W2 wire): previous payload's surface element lines. */
    previousSurfaceLines?: readonly string[];
    onPacingWait?: (durationMs: number) => void;
  }): Promise<{
    output: PlannerOutput;
    rawText: string;
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
  }>;
}

export interface V2AgentHarnessRuntime extends V2ToolRuntime {
  open(url: string): Promise<BrowserObservation>;
  observe(): Promise<BrowserObservation>;
  getCurrentObservation?(): BrowserObservation | undefined;
  close(): Promise<void>;
  flushTrace(): Promise<TraceManifest>;
  recordPlannerInput?(episodeId: string, input: unknown): TraceArtifact;
  recordCompactPlannerInput?(episodeId: string, input: unknown): TraceArtifact;
  recordPlannerOutput?(episodeId: string, output: unknown): TraceArtifact;
  recordFailureEvidence?(failure: FailureEvidence): TraceArtifact;
  setLatencyLedger?(ledger: import('../trace/LatencyLedger').LatencyLedger): void;
  recordLatencyLedger?(summary: import('../trace/LatencyLedger').LedgerSummary): void;
  recordActionOutcomes?(summary: unknown): void;
}

export interface V2AgentLoopOptions {
  harnessFactory?: () => V2AgentHarnessRuntime;
  plannerClient?: V2PlannerClientLike;
  dispatcherFactory?: (runtime: V2ToolRuntime) => V2ToolDispatcherLike;
  traceDir?: string;
  headed?: boolean;
  runId?: string;
  viewport?: BrowserSessionOptions['viewport'];
}

export interface V2AgentToolDispatcherContext extends V2ToolDispatchContext {}
