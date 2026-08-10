export interface RuntimeBenchmarkResult {
  taskId: string;
  success: boolean;
  passed: boolean;
  value?: string;
  failureReason?: string;
}

export interface EvaluatorVerdict {
  taskId: string;
  internalPassed: boolean;
  strictScore: number;
  manualCorrectedScore: number;
  partialCredit: number;
  environmentStatus: string;
  referenceMatchType: string;
  needsManualReview: boolean;
  reasons: string[];
}

export type JoinedBenchmarkCategory =
  | 'success'
  | 'internal_complete_strict_reject'
  | 'environment'
  | 'runtime_failure'
  | 'evaluation_missing';

export interface JoinedBenchmarkResult {
  taskId: string;
  runtime: RuntimeBenchmarkResult;
  evaluator?: EvaluatorVerdict;
  category: JoinedBenchmarkCategory;
  runtimePassed: boolean;
  strictPassed: boolean;
}

export function joinBenchmarkEvaluation(
  runtimeResults: readonly RuntimeBenchmarkResult[],
  evaluatorVerdicts: readonly EvaluatorVerdict[],
): JoinedBenchmarkResult[] {
  const verdictByTaskId = new Map(evaluatorVerdicts.map(verdict => [verdict.taskId, verdict]));

  return runtimeResults.map(runtime => {
    const evaluator = verdictByTaskId.get(runtime.taskId);
    const strictPassed = evaluator?.strictScore === 1;
    const runtimePassed = runtime.success === true;

    return {
      taskId: runtime.taskId,
      runtime,
      evaluator,
      category: classifyJoinedResult(runtime, evaluator),
      runtimePassed,
      strictPassed,
    };
  });
}

function classifyJoinedResult(
  runtime: RuntimeBenchmarkResult,
  evaluator: EvaluatorVerdict | undefined,
): JoinedBenchmarkCategory {
  if (!evaluator) return 'evaluation_missing';
  if (evaluator.environmentStatus === 'environment_block') return 'environment';
  if (runtime.success && evaluator.strictScore === 1) return 'success';
  if (runtime.success) return 'internal_complete_strict_reject';
  return 'runtime_failure';
}
