export type WebVoyagerJudgeVerdict = 'pass' | 'partial' | 'fail' | 'unknown';

export interface WebVoyagerJudgeInput {
  taskId: string;
  task: string;
  url: string;
  referenceAnswer?: unknown;
  finalAnswer: string;
  traceSummary: string;
  screenshotPaths: string[];
  currentDateIso: string;
}

export interface WebVoyagerJudgeResult {
  verdict: WebVoyagerJudgeVerdict;
  confidence: 'high' | 'medium' | 'low';
  failureReason: string;
  impossibleTask: boolean;
  reachedCaptcha: boolean;
  referenceMatchType: 'exact' | 'semantic_subset' | 'partial' | 'mismatch' | 'not_applicable';
}

export function isWebVoyagerJudgeResult(value: unknown): value is WebVoyagerJudgeResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as WebVoyagerJudgeResult;
  return ['pass', 'partial', 'fail', 'unknown'].includes(candidate.verdict)
    && ['high', 'medium', 'low'].includes(candidate.confidence)
    && typeof candidate.failureReason === 'string'
    && typeof candidate.impossibleTask === 'boolean'
    && typeof candidate.reachedCaptcha === 'boolean'
    && ['exact', 'semantic_subset', 'partial', 'mismatch', 'not_applicable'].includes(candidate.referenceMatchType);
}
