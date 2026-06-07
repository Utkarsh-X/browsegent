import type { BenchmarkTask } from '../v2/types';

export interface WebVoyagerSourceTask {
  id: string;
  webName: string;
  question: string;
  url: string;
}

export interface WebVoyagerReferenceAnswer {
  id: string;
  webName: string;
  type?: string;
  answer: unknown;
}

export interface NormalizedWebVoyagerTask extends WebVoyagerSourceTask {
  originalQuestion: string;
  normalized: boolean;
  normalizationReason?: string;
}

export interface WebVoyagerBenchmarkTask extends BenchmarkTask {
  webVoyager: {
    id: string;
    webName: string;
    originalQuestion: string;
    normalizedQuestion: string;
    normalized: boolean;
    normalizationReason?: string;
    referenceAnswer?: WebVoyagerReferenceAnswer;
  };
}

export type WebVoyagerReferenceMatchType = 'exact' | 'semantic_subset' | 'partial' | 'mismatch' | 'missing_reference' | 'not_applicable';

export type WebVoyagerEnvironmentStatus = 'normal' | 'environment_block' | 'impossible_task';

export type WebVoyagerManualVerdict = 'pass' | 'partial' | 'fail' | 'environment_block' | 'impossible';

export interface WebVoyagerManualAuditEntry {
  taskId: string;
  verdict: WebVoyagerManualVerdict;
  reason: string;
  reviewer?: string;
}

export interface WebVoyagerManualAuditFile {
  runId?: string;
  entries: WebVoyagerManualAuditEntry[];
}

export interface WebVoyagerVerdict {
  taskId: string;
  internalPassed: boolean;
  rawAutoScore: number;
  strictScore: number;
  manualCorrectedScore: number;
  partialCredit: number;
  environmentAdjustedEligible: boolean;
  environmentStatus: WebVoyagerEnvironmentStatus;
  referenceMatchType: WebVoyagerReferenceMatchType;
  needsManualReview: boolean;
  manualVerdict?: WebVoyagerManualVerdict;
  reasons: string[];
}

export interface WebVoyagerEvaluationSummary {
  totalRuns: number;
  internalPassRate: number;
  rawAutoScore: number;
  strictScore: number;
  manualCorrectedScore: number;
  partialCreditRate: number;
  environmentAdjustedStrictScore: number;
  environmentAdjustedManualScore: number;
  manualReviewCount: number;
  environmentBlockedCount: number;
  impossibleTaskCount: number;
}

export type WebVoyagerTaskStatus =
  | 'valid'
  | 'impossible'
  | 'date_normalized'
  | 'environment_block_risk'
  | 'ambiguous';

export type WebVoyagerBenchmarkSlice = 'mvr5' | 'mvr5-stable' | 'balanced30';

export interface WebVoyagerTaskRegistryEntry {
  id: string;
  status: WebVoyagerTaskStatus;
  source: 'browser_use_eval' | 'browsegent' | 'manual_review';
  reason: string;
}

export interface WebVoyagerTaskArtifactSummary {
  taskId: string;
  webVoyagerId: string;
  webName: string;
  goal: string;
  url: string;
  referenceAnswer?: unknown;
  finalAnswer: string;
  adapterPassed: boolean;
  failureType?: string;
  failureReason?: string;
  tracePath?: string;
  artifactPath?: string;
  plannerCalls: number;
  toolExecutions: number;
  durationMs: number;
}
