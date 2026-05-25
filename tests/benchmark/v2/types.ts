export type BenchmarkDifficulty = 'extraction' | 'navigation' | 'interaction' | 'recovery' | 'adversarial';
export type BenchmarkPartition = 'dev' | 'holdout';

export type BenchmarkFailureType =
  | 'perception_error'
  | 'action_error'
  | 'planning_error'
  | 'environment_block'
  | 'validation_error'
  | 'rate_limited'
  | 'trace_error'
  | 'runtime_crash'
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
}

export interface BenchmarkAdapterResult {
  adapterId: string;
  taskId: string;
  attempt: number;
  success: boolean;
  value: string;
  tracePath?: string;
  failureReason?: string;
  failureType?: BenchmarkFailureType;
  metrics: {
    plannerCalls: number;
    toolExecutions: number;
    durationMs: number;
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface BenchmarkAdapter {
  adapterId: string;
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
  };
  results: ScoredBenchmarkResult[];
}
