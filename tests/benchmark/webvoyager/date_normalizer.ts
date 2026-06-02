import type { NormalizedWebVoyagerTask, WebVoyagerSourceTask } from './types';

const TIME_SENSITIVE_TRAVEL_SITES = new Set(['Booking', 'Google Flights']);

export function normalizeWebVoyagerTaskDate(
  task: WebVoyagerSourceTask,
  runDate: Date = new Date(),
): NormalizedWebVoyagerTask {
  const originalQuestion = task.question;
  if (!TIME_SENSITIVE_TRAVEL_SITES.has(task.webName)) {
    return { ...task, originalQuestion, normalized: false };
  }

  const runYear = runDate.getUTCFullYear();
  const replacementYear = runYear + 1;
  let changed = false;
  const question = task.question.replace(/\b(20\d{2})\b/g, rawYear => {
    const year = Number(rawYear);
    if (year <= runYear) {
      changed = true;
      return String(replacementYear);
    }
    return rawYear;
  });

  return {
    ...task,
    question,
    originalQuestion,
    normalized: changed,
    normalizationReason: changed
      ? `Replaced past or current travel date year with ${replacementYear} relative to run year ${runYear}.`
      : undefined,
  };
}
