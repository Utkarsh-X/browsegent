import { normalizeWebVoyagerTaskDate } from './date_normalizer';
import { assertStableSliceContainsNoImpossibleTasks, WEBVOYAGER_STABLE_SLICES } from './task_registry';
import type { WebVoyagerBenchmarkSlice, WebVoyagerBenchmarkTask, WebVoyagerReferenceAnswer, WebVoyagerSourceTask } from './types';

export type WebVoyagerTaskSlice = WebVoyagerBenchmarkSlice;

export function resolveWebVoyagerTaskIds(slice: WebVoyagerTaskSlice = 'balanced30'): readonly string[] {
  assertStableSliceContainsNoImpossibleTasks(slice);
  return WEBVOYAGER_STABLE_SLICES[slice];
}

export const WEBVOYAGER_LITE_TASK_IDS = WEBVOYAGER_STABLE_SLICES.balanced30;
export const WEBVOYAGER_MVR_5_TASK_IDS = WEBVOYAGER_STABLE_SLICES.mvr5;
export const WEBVOYAGER_MVR_5_STABLE_TASK_IDS = WEBVOYAGER_STABLE_SLICES['mvr5-stable'];

export function selectWebVoyagerLiteTasks(
  sourceTasks: WebVoyagerSourceTask[],
  ids: readonly string[] = WEBVOYAGER_LITE_TASK_IDS,
): WebVoyagerSourceTask[] {
  const byId = new Map(sourceTasks.map(task => [task.id, task]));
  const missing = ids.filter(id => !byId.has(id));
  if (missing.length > 0) {
    throw new Error(`Missing WebVoyager-lite task ids: ${missing.join(', ')}`);
  }
  return ids.map(id => byId.get(id)!);
}

export function toBenchmarkTasks(
  sourceTasks: WebVoyagerSourceTask[],
  references: Map<string, WebVoyagerReferenceAnswer>,
  runDate: Date = new Date(),
): WebVoyagerBenchmarkTask[] {
  return sourceTasks.map(sourceTask => {
    const normalized = normalizeWebVoyagerTaskDate(sourceTask, runDate);
    return {
      taskId: toBenchmarkTaskId(normalized.id),
      category: 'webvoyager',
      difficulty: 'navigation',
      partition: 'holdout',
      url: normalized.url,
      goal: normalized.question,
      validation: { minLength: 2 },
      maxSteps: 12,
      webVoyager: {
        id: normalized.id,
        webName: normalized.webName,
        originalQuestion: normalized.originalQuestion,
        normalizedQuestion: normalized.question,
        normalized: normalized.normalized,
        normalizationReason: normalized.normalizationReason,
        referenceAnswer: references.get(normalized.id),
      },
    };
  });
}

function toBenchmarkTaskId(webVoyagerId: string): string {
  return `webvoyager_${webVoyagerId.replace(/[^a-z0-9]+/gi, '__')}`;
}
