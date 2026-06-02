import type { ScoredBenchmarkResult } from '../v2/types';
import type {
  WebVoyagerBenchmarkTask,
  WebVoyagerEvaluationSummary,
  WebVoyagerVerdict,
} from './types';

export function evaluateWebVoyagerResult(
  task: WebVoyagerBenchmarkTask,
  result: ScoredBenchmarkResult,
): WebVoyagerVerdict {
  const reasons: string[] = [];
  const reference = task.webVoyager.referenceAnswer;

  if (!result.passed) {
    reasons.push('benchmark_result_failed');
    return {
      taskId: task.taskId,
      rawAutoScore: 0,
      strictScore: 0,
      needsManualReview: false,
      reasons,
    };
  } else if (!reference) {
    reasons.push('missing_reference');
  }

  const referenceMatched = reference ? answerMatchesReference(result.value, reference.answer) : false;
  if (reference && !referenceMatched) {
    reasons.push('reference_mismatch');
  }

  const rawAutoScore = result.passed && referenceMatched ? 1 : 0;
  return {
    taskId: task.taskId,
    rawAutoScore,
    strictScore: rawAutoScore,
    needsManualReview: !reference || reasons.includes('reference_mismatch'),
    reasons,
  };
}

export function summarizeWebVoyagerEvaluation(verdicts: WebVoyagerVerdict[]): WebVoyagerEvaluationSummary {
  const totalRuns = verdicts.length;
  return {
    totalRuns,
    rawAutoScore: ratio(sum(verdicts.map(verdict => verdict.rawAutoScore)), totalRuns),
    strictScore: ratio(sum(verdicts.map(verdict => verdict.strictScore)), totalRuns),
    manualReviewCount: verdicts.filter(verdict => verdict.needsManualReview).length,
  };
}

function answerMatchesReference(value: string, answer: unknown): boolean {
  const normalizedValue = normalize(value);
  const candidates = Array.isArray(answer) ? answer : [answer];
  return candidates
    .flatMap(candidate => typeof candidate === 'string' ? [candidate] : [JSON.stringify(candidate)])
    .filter(Boolean)
    .some(candidate => normalize(candidate).length > 0 && normalizedValue.includes(normalize(candidate)));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}
