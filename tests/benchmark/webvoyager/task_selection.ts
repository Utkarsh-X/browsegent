import { normalizeWebVoyagerTaskDate } from './date_normalizer';
import type { WebVoyagerBenchmarkTask, WebVoyagerReferenceAnswer, WebVoyagerSourceTask } from './types';

export const WEBVOYAGER_LITE_TASK_IDS = [
  'Allrecipes--3',
  'Allrecipes--10',
  'Amazon--0',
  'Amazon--10',
  'Apple--0',
  'Apple--10',
  'ArXiv--0',
  'ArXiv--10',
  'BBC News--0',
  'BBC News--10',
  'Booking--0',
  'Booking--10',
  'Cambridge Dictionary--0',
  'Cambridge Dictionary--10',
  'Coursera--0',
  'Coursera--10',
  'ESPN--0',
  'ESPN--10',
  'GitHub--0',
  'GitHub--10',
  'Google Flights--0',
  'Google Flights--10',
  'Google Map--0',
  'Google Map--10',
  'Google Search--0',
  'Google Search--10',
  'Huggingface--0',
  'Huggingface--10',
  'Wolfram Alpha--0',
  'Wolfram Alpha--10',
] as const;

export const WEBVOYAGER_MVR_5_TASK_IDS = [
  'Allrecipes--3',
  'ArXiv--0',
  'GitHub--0',
  'Google Map--10',
  'Wolfram Alpha--0',
] as const;

export type WebVoyagerTaskSlice = 'balanced30' | 'mvr5';

export function resolveWebVoyagerTaskIds(slice: WebVoyagerTaskSlice = 'balanced30'): readonly string[] {
  return slice === 'mvr5' ? WEBVOYAGER_MVR_5_TASK_IDS : WEBVOYAGER_LITE_TASK_IDS;
}

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
