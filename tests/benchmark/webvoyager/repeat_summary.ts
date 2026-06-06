import type { WebVoyagerEvaluationSummary } from './types';

export interface WebVoyagerRepeatSummary {
  runs: number;
  strictMean: number;
  strictStdDev: number;
  manualMean: number;
  manualStdDev: number;
  environmentAdjustedManualMean: number;
  environmentAdjustedManualStdDev: number;
}

export function summarizeWebVoyagerRepeats(summaries: WebVoyagerEvaluationSummary[]): WebVoyagerRepeatSummary {
  return {
    runs: summaries.length,
    strictMean: mean(summaries.map(summary => summary.strictScore)),
    strictStdDev: stdDev(summaries.map(summary => summary.strictScore)),
    manualMean: mean(summaries.map(summary => summary.manualCorrectedScore)),
    manualStdDev: stdDev(summaries.map(summary => summary.manualCorrectedScore)),
    environmentAdjustedManualMean: mean(summaries.map(summary => summary.environmentAdjustedManualScore)),
    environmentAdjustedManualStdDev: stdDev(summaries.map(summary => summary.environmentAdjustedManualScore)),
  };
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length <= 1) return 0;
  const average = mean(values);
  const variance = values.reduce((total, value) => total + (value - average) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}
