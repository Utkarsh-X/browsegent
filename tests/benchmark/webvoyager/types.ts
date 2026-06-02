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

export interface WebVoyagerVerdict {
  taskId: string;
  rawAutoScore: number;
  strictScore: number;
  needsManualReview: boolean;
  reasons: string[];
}

export interface WebVoyagerEvaluationSummary {
  totalRuns: number;
  rawAutoScore: number;
  strictScore: number;
  manualReviewCount: number;
}
