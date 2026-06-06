import type { ScoredBenchmarkResult } from '../v2/types';
import type {
  WebVoyagerBenchmarkTask,
  WebVoyagerEvaluationSummary,
  WebVoyagerEnvironmentStatus,
  WebVoyagerManualAuditEntry,
  WebVoyagerReferenceMatchType,
  WebVoyagerVerdict,
} from './types';

export function evaluateWebVoyagerResult(
  task: WebVoyagerBenchmarkTask,
  result: ScoredBenchmarkResult,
  manualAudit?: WebVoyagerManualAuditEntry,
): WebVoyagerVerdict {
  const reasons: string[] = [];
  const reference = task.webVoyager.referenceAnswer;
  const internalPassed = result.passed === true;
  const environmentStatus = classifyEnvironmentStatus(result, manualAudit);
  const referenceMatchType = reference ? classifyReferenceMatch(result.value, reference.answer) : 'missing_reference';

  if (!internalPassed) reasons.push('benchmark_result_failed');
  if (!reference) reasons.push('missing_reference');
  if (reference && referenceMatchType === 'mismatch') reasons.push('reference_mismatch');
  if (manualAudit) reasons.push(`manual_${manualAudit.verdict}`);

  const strictScore = internalPassed && referenceMatchType !== 'mismatch' && referenceMatchType !== 'missing_reference' ? 1 : 0;
  const manualCorrectedScore = scoreManual(manualAudit, strictScore);
  const partialCredit = scorePartial(manualAudit, strictScore, referenceMatchType);

  return {
    taskId: task.taskId,
    internalPassed,
    rawAutoScore: strictScore,
    strictScore,
    manualCorrectedScore,
    partialCredit,
    environmentAdjustedEligible: environmentStatus === 'normal',
    environmentStatus,
    referenceMatchType,
    needsManualReview: !manualAudit && (!reference || referenceMatchType === 'mismatch' || referenceMatchType === 'partial'),
    manualVerdict: manualAudit?.verdict,
    reasons,
  };
}

export function summarizeWebVoyagerEvaluation(verdicts: WebVoyagerVerdict[]): WebVoyagerEvaluationSummary {
  const totalRuns = verdicts.length;
  const eligible = verdicts.filter(verdict => verdict.environmentAdjustedEligible);
  return {
    totalRuns,
    internalPassRate: ratio(verdicts.filter(verdict => verdict.internalPassed).length, totalRuns),
    rawAutoScore: ratio(sum(verdicts.map(verdict => verdict.rawAutoScore)), totalRuns),
    strictScore: ratio(sum(verdicts.map(verdict => verdict.strictScore)), totalRuns),
    manualCorrectedScore: ratio(sum(verdicts.map(verdict => verdict.manualCorrectedScore)), totalRuns),
    partialCreditRate: ratio(sum(verdicts.map(verdict => verdict.partialCredit)), totalRuns),
    environmentAdjustedStrictScore: ratio(sum(eligible.map(verdict => verdict.strictScore)), eligible.length),
    environmentAdjustedManualScore: ratio(sum(eligible.map(verdict => verdict.manualCorrectedScore)), eligible.length),
    manualReviewCount: verdicts.filter(verdict => verdict.needsManualReview).length,
    environmentBlockedCount: verdicts.filter(verdict => verdict.environmentStatus === 'environment_block').length,
    impossibleTaskCount: verdicts.filter(verdict => verdict.environmentStatus === 'impossible_task').length,
  };
}

function classifyEnvironmentStatus(
  result: ScoredBenchmarkResult,
  manualAudit: WebVoyagerManualAuditEntry | undefined,
): WebVoyagerEnvironmentStatus {
  if (manualAudit?.verdict === 'environment_block') return 'environment_block';
  if (manualAudit?.verdict === 'impossible') return 'impossible_task';
  if (result.failureType === 'environment_block') return 'environment_block';
  return 'normal';
}

function scoreManual(manualAudit: WebVoyagerManualAuditEntry | undefined, strictScore: number): number {
  if (!manualAudit) return strictScore;
  if (manualAudit.verdict === 'pass') return 1;
  return 0;
}

function scorePartial(
  manualAudit: WebVoyagerManualAuditEntry | undefined,
  strictScore: number,
  referenceMatchType: WebVoyagerReferenceMatchType,
): number {
  if (manualAudit?.verdict === 'partial') return 0.5;
  if (manualAudit?.verdict === 'pass') return 1;
  if (strictScore === 1) return 1;
  if (referenceMatchType === 'partial') return 0.5;
  return 0;
}

function classifyReferenceMatch(value: string, answer: unknown): WebVoyagerReferenceMatchType {
  const normalizedValue = normalize(value);
  const candidates = Array.isArray(answer) ? answer : [answer];
  const normalizedCandidates = candidates
    .flatMap(candidate => typeof candidate === 'string' ? [candidate] : [JSON.stringify(candidate)])
    .map(normalize)
    .filter(Boolean);

  if (normalizedCandidates.some(candidate => normalizedValue === candidate || normalizedValue.includes(candidate))) {
    return 'exact';
  }

  if (normalizedCandidates.some(candidate => candidate.includes(normalizedValue) && normalizedValue.length >= 12)) {
    return 'semantic_subset';
  }

  if (normalizedCandidates.some(candidate => hasTokenOverlap(normalizedValue, candidate, 0.6))) {
    return 'partial';
  }

  return 'mismatch';
}

function hasTokenOverlap(left: string, right: string, threshold: number): boolean {
  const leftTokens = new Set(left.split(/\s+/).filter(token => token.length >= 3));
  const rightTokens = new Set(right.split(/\s+/).filter(token => token.length >= 3));
  if (rightTokens.size === 0) return false;
  let matched = 0;
  for (const token of rightTokens) {
    if (leftTokens.has(token)) matched++;
  }
  return matched / rightTokens.size >= threshold;
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
