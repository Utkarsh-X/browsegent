export type BenchmarkDifficulty = 'extraction' | 'navigation' | 'interaction' | 'recovery' | 'adversarial';
export type BenchmarkPartition = 'dev' | 'holdout';

export type BenchmarkFailureType =
  | 'perception_error'
  | 'action_error'
  | 'planning_error'
  | 'environment_block'
  | 'validation_error'
  | 'budget_exceeded'
  | 'rate_limited'
  | 'trace_error'
  | 'runtime_crash'
  | 'runtime_startup_failure'
  | 'unknown';

export interface BenchmarkValidationSpec {
  minLength?: number;
  requireAny?: string[];
  requireAll?: string[];
  forbid?: string[];
}

export interface BenchmarkTask {
  taskId: string;
  category: string;
  difficulty: BenchmarkDifficulty;
  partition: BenchmarkPartition;
  url: string;
  goal: string;
  validation: BenchmarkValidationSpec;
  expectedFailureType?: BenchmarkFailureType;
  maxSteps?: number;
}

export interface BenchmarkAdapterRunOptions {
  runId: string;
  attempt: number;
  model?: string;
  maxSteps?: number;
  traceDir: string;
  headed: boolean;
  requestMinIntervalMs?: number;
  plannerMode?: 'current' | 'compact_enforced';
}

export type BenchmarkEvidenceMode = 'browsegent_trace' | 'external_artifact';

export interface BenchmarkAdapterResult {
  adapterId: string;
  taskId: string;
  attempt: number;
  success: boolean;
  value: string;
  tracePath?: string;
  artifactPath?: string;
  failureReason?: string;
  failureType?: BenchmarkFailureType;
  metrics: {
    plannerCalls: number;
    toolExecutions: number;
    durationMs: number;
    inputTokens?: number;
    outputTokens?: number;
  };
  diagnostics?: BenchmarkDiagnostics;
}

export interface BenchmarkAdapter {
  adapterId: string;
  traceMode?: BenchmarkEvidenceMode;
  run(task: BenchmarkTask, options: BenchmarkAdapterRunOptions): Promise<BenchmarkAdapterResult>;
}

export interface BenchmarkValidationResult {
  passed: boolean;
  reasons: string[];
  preview: string;
}

export interface BenchmarkTraceScore {
  ok: boolean;
  errors: string[];
}

export interface ScoredBenchmarkResult extends BenchmarkAdapterResult {
  partition: BenchmarkPartition;
  passed: boolean;
  validation: BenchmarkValidationResult;
  trace: BenchmarkTraceScore;
}

export interface BenchmarkPartitionSummary {
  totalRuns: number;
  passedRuns: number;
  failedRuns: number;
  passRate: number;
  traceCompleteRate: number;
}

export interface BenchmarkReport {
  runId: string;
  adapterId: string;
  startedAt: string;
  completedAt: string;
  model?: string;
  runMetadata?: BenchmarkRunMetadata;
  summary: {
    totalRuns: number;
    passedRuns: number;
    failedRuns: number;
    passRate: number;
    traceCompleteRate: number;
    avgPlannerCalls: number;
    avgToolExecutions: number;
    avgDurationMs: number;
    failureTypes: Record<string, number>;
    partitions: Record<BenchmarkPartition, BenchmarkPartitionSummary>;
    diagnostics?: BenchmarkDiagnosticsSummary;
  };
  results: ScoredBenchmarkResult[];
}

export interface BenchmarkPayloadSizeSummary {
  count: number;
  totalBytes: number;
  maxBytes: number;
}

export interface BenchmarkPayloadDiagnostics {
  traceBytes: number;
  observations: BenchmarkPayloadSizeSummary;
  plannerInputs: BenchmarkPayloadSizeSummary;
  plannerInputSections: BenchmarkPlannerInputSectionDiagnostics;
  plannerOutputs: BenchmarkPayloadSizeSummary;
  failures: BenchmarkPayloadSizeSummary;
}

export interface BenchmarkPlannerInputSectionDiagnostics {
  goal: BenchmarkPayloadSizeSummary;
  current: BenchmarkPayloadSizeSummary;
  currentInteractions: BenchmarkPayloadSizeSummary;
  currentReadables: BenchmarkPayloadSizeSummary;
  currentNavigation: BenchmarkPayloadSizeSummary;
  currentRegions: BenchmarkPayloadSizeSummary;
  continuity: BenchmarkPayloadSizeSummary;
  transition: BenchmarkPayloadSizeSummary;
  lineage: BenchmarkPayloadSizeSummary;
  failures: BenchmarkPayloadSizeSummary;
  deadState: BenchmarkPayloadSizeSummary;
  uncertainty: BenchmarkPayloadSizeSummary;
}

export interface BenchmarkActionDiagnostics {
  stepCount: number;
  failedStepCount: number;
  repeatedActionCount: number;
  invalidActionCount: number;
}

export interface BenchmarkDiagnostics {
  payloads: BenchmarkPayloadDiagnostics;
  actions: BenchmarkActionDiagnostics;
  projectionOverlap: BenchmarkProjectionOverlapDiagnostics;
  workingSet: BenchmarkWorkingSetDiagnostics;
  warnings: string[];
}

export interface BenchmarkProjectionOverlapDiagnostics {
  maxMultiSectionRefCount: number;
  maxInteractionReadableOverlap: number;
  maxInteractionNavigationOverlap: number;
  maxReadableNavigationOverlap: number;
}

export interface BenchmarkWorkingSetDiagnostics {
  maxObservedRefs: number;
  maxSelectedRefs: number;
  maxDroppedRefs: number;
  selectedByReason: Record<string, number>;
  droppedByReason: Record<string, number>;
}

export interface BenchmarkDiagnosticsSummary {
  maxTraceBytes: number;
  maxPlannerInputBytes: number;
  maxProjectionBytes: number;
  maxReadableProjectionBytes: number;
  maxInteractionProjectionBytes: number;
  maxObservationBytes: number;
  totalFailedSteps: number;
  totalRepeatedActions: number;
  totalInvalidActions: number;
  maxProjectionMultiSectionRefs: number;
  maxProjectionInteractionReadableOverlap: number;
  maxWorkingSetObservedRefs: number;
  maxWorkingSetSelectedRefs: number;
  maxWorkingSetDroppedRefs: number;
  warningCount: number;
}

export interface BenchmarkRunMetadata {
  geminiKeyPool?: {
    keyCount: number;
    configuredKeyCount?: number;
    uniqueKeyCount?: number;
    duplicateKeyCount?: number;
    keyIndex?: number;
    selectedEnvName?: string;
    assignmentMode?: 'per_run' | 'per_task_attempt';
    assignments?: BenchmarkGeminiKeyAssignment[];
  };
  rateLimit?: {
    mode: 'disabled' | 'paced';
    requestRpm?: number;
    minIntervalMs: number;
  };
}

export interface BenchmarkGeminiKeyAssignment {
  taskId: string;
  attempt: number;
  keyIndex: number;
  selectedEnvName: string;
}
