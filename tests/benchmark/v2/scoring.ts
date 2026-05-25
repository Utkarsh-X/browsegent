import type {
  BenchmarkAdapterResult,
  BenchmarkTask,
  BenchmarkTraceScore,
  BenchmarkValidationResult,
  ScoredBenchmarkResult,
} from './types';

export function scoreBenchmarkResult(
  task: BenchmarkTask,
  result: BenchmarkAdapterResult,
  trace: BenchmarkTraceScore,
): ScoredBenchmarkResult {
  const validation = validateValue(task, result.value);
  const failureType = result.failureType ?? inferFailureType(result, validation, trace);
  const expectedFailurePassed = task.expectedFailureType !== undefined
    && !result.success
    && failureType === task.expectedFailureType
    && trace.ok;
  const passed = expectedFailurePassed || (result.success && validation.passed && trace.ok);

  return {
    ...result,
    partition: task.partition,
    passed,
    validation,
    trace,
    failureType,
  };
}

function validateValue(task: BenchmarkTask, value: string): BenchmarkValidationResult {
  const reasons: string[] = [];
  const normalized = value.trim();
  const spec = task.validation;

  if (spec.minLength !== undefined && normalized.length < spec.minLength) {
    reasons.push(`minLength:${spec.minLength}`);
  }

  if (spec.requireAny && spec.requireAny.length > 0 && !spec.requireAny.some(pattern => new RegExp(pattern, 'i').test(normalized))) {
    reasons.push(`requireAny:${spec.requireAny.join('|')}`);
  }

  if (spec.requireAll) {
    for (const pattern of spec.requireAll) {
      if (!new RegExp(pattern, 'i').test(normalized)) {
        reasons.push(`requireAll:${pattern}`);
      }
    }
  }

  if (spec.forbid) {
    for (const pattern of spec.forbid) {
      if (new RegExp(pattern, 'i').test(normalized)) {
        reasons.push(`forbid:${pattern}`);
      }
    }
  }

  return {
    passed: reasons.length === 0,
    reasons,
    preview: normalized.slice(0, 240),
  };
}

function inferFailureType(
  result: BenchmarkAdapterResult,
  validation: BenchmarkValidationResult,
  trace: BenchmarkTraceScore,
): ScoredBenchmarkResult['failureType'] {
  if (result.failureReason?.match(/API_QUOTA_EXCEEDED|rate limit|rate_limited|429|RESOURCE_EXHAUSTED/i)) return 'rate_limited';
  if (result.failureReason?.match(/planner_escalated:captcha|captcha|verification required/i)) return 'environment_block';
  if (result.failureReason?.match(/planner_client_error|Planner output invalid|planner/i)) return 'planning_error';
  if (!trace.ok) return 'trace_error';
  if (!validation.passed) return 'validation_error';
  if (result.failureReason?.match(/blocked|hidden|disabled|stale|target/i)) return 'action_error';
  if (result.failureReason?.match(/captcha|access denied/i)) return 'environment_block';
  if (!result.success) return 'unknown';
  return undefined;
}
