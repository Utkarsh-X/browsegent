import type { ScoredBenchmarkResult } from '../v2/types';
import type { WebVoyagerBenchmarkTask, WebVoyagerTaskArtifactSummary } from './types';

export function buildWebVoyagerTaskArtifactSummary(
  task: WebVoyagerBenchmarkTask,
  result: ScoredBenchmarkResult,
): WebVoyagerTaskArtifactSummary {
  return {
    taskId: task.taskId,
    webVoyagerId: task.webVoyager.id,
    webName: task.webVoyager.webName,
    goal: task.goal,
    url: task.url,
    referenceAnswer: task.webVoyager.referenceAnswer?.answer,
    finalAnswer: result.value,
    adapterPassed: result.success,
    failureType: result.failureType,
    failureReason: result.failureReason,
    tracePath: result.tracePath,
    artifactPath: result.artifactPath,
    plannerCalls: result.metrics.plannerCalls,
    toolExecutions: result.metrics.toolExecutions,
    durationMs: result.metrics.durationMs,
  };
}
