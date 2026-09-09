/**
 * Diagnosis-first telemetry for WebArena runs. Pure functions over plain run
 * records: classify WHY a task failed, attribute failures across sites, split
 * winnable misses from unwinnable environment noise, and expose efficiency
 * trends. Nothing here touches src/v2 — it joins artifacts the loop already
 * records with the evaluator verdict.
 */

export type WebArenaFailureClass =
  | 'passed'
  | 'grounding'
  | 'planner_strategy'
  | 'budget'
  | 'recovery'
  | 'environment_block'
  | 'evaluator_side';

export interface DiagnosisInput {
  site: string;
  internalSuccess: boolean;
  failureReason?: string;
  warnings?: string[];
  /** Official evaluator score; undefined = not scored (bridge missing/failed). */
  score?: number;
  evaluatorError?: string;
  plannerCalls: number;
  toolExecutions: number;
  durationMs: number;
}

export interface DiagnosisRecord extends DiagnosisInput {
  taskId: string;
  failureClass: WebArenaFailureClass;
  /** Winnable = an agent-side class the system can actually improve on. */
  winnable: boolean;
}

export interface DiagnosisSummary {
  total: number;
  byClass: Record<WebArenaFailureClass, number>;
  /** site × failureClass counts — where in the web does it break? */
  attributionMatrix: Record<string, Record<string, number>>;
  winnable: { attempted: number; passed: number; passRate: number };
  unwinnable: { count: number; byClass: Record<string, number> };
  unscored: string[];
  efficiency: {
    passedMedianPlannerCalls?: number;
    passedMedianToolExecutions?: number;
    passedMedianDurationMs?: number;
  };
}

const ENVIRONMENT_PATTERNS = [
  /net::ERR/i,
  /ECONNREFUSED/,
  /ENOTFOUND/,
  /ETIMEDOUT/,
  /unresolved_webarena_site_placeholder/,
  /reset_failed/,
  /docker/i,
  /BrowserType\.launch/,
  /Target page, context or browser has been closed/i,
  /navigation timeout/i,
];

const RECOVERY_PATTERNS = [/rate.?limit/i, /\b429\b/, /provider_retry_exhausted/i, /upstream/i];
const BUDGET_PATTERNS = [/step_budget/i, /max.?steps/i, /budget_exhausted/i];

/** Deterministic classification; first match wins, defaults to honest agent-side buckets. */
export function classifyRun(input: DiagnosisInput): { failureClass: WebArenaFailureClass; winnable: boolean } {
  if (input.score === 1) return { failureClass: 'passed', winnable: true };
  const reason = input.failureReason ?? '';

  // Environment problems dominate everything else: an agent cannot fix a dead stack.
  if (ENVIRONMENT_PATTERNS.some(pattern => pattern.test(reason))) {
    return { failureClass: 'environment_block', winnable: false };
  }
  if (input.evaluatorError) return { failureClass: 'evaluator_side', winnable: false };
  if (RECOVERY_PATTERNS.some(pattern => pattern.test(reason))) {
    return { failureClass: 'recovery', winnable: true };
  }

  if (input.internalSuccess) {
    if (input.score === undefined) {
      // Agent believes it is done but nobody scored it — never counted as pass.
      return { failureClass: 'evaluator_side', winnable: false };
    }
    // Answer produced confidently yet failed deterministic evaluation:
    // the answer did not match reality — exactly what grounding work targets.
    return { failureClass: 'grounding', winnable: true };
  }

  if (BUDGET_PATTERNS.some(pattern => pattern.test(reason))) {
    return { failureClass: 'budget', winnable: true };
  }
  return { failureClass: 'planner_strategy', winnable: true };
}

export function diagnose(taskId: string, input: DiagnosisInput): DiagnosisRecord {
  const { failureClass, winnable } = classifyRun(input);
  return { ...input, taskId, failureClass, winnable };
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

export function summarizeDiagnoses(records: DiagnosisRecord[]): DiagnosisSummary {
  const byClass = emptyClassCounter();
  const attributionMatrix: Record<string, Record<string, number>> = {};
  const unwinnableByClass: Record<string, number> = {};
  const passedRecords: DiagnosisRecord[] = [];
  const unscored: string[] = [];

  for (const record of records) {
    byClass[record.failureClass] += 1;
    const row = attributionMatrix[record.site] ?? (attributionMatrix[record.site] = {});
    row[record.failureClass] = (row[record.failureClass] ?? 0) + 1;

    if (!record.winnable) {
      unwinnableByClass[record.failureClass] = (unwinnableByClass[record.failureClass] ?? 0) + 1;
    }
    if (record.score === undefined) unscored.push(record.taskId);
    if (record.failureClass === 'passed') passedRecords.push(record);
  }

  const winnableRecords = records.filter(record => record.winnable);
  const winnablePassed = winnableRecords.filter(record => record.failureClass === 'passed').length;

  return {
    total: records.length,
    byClass,
    attributionMatrix,
    winnable: {
      attempted: winnableRecords.length,
      passed: winnablePassed,
      passRate: winnableRecords.length === 0 ? 0 : round2(winnablePassed / winnableRecords.length),
    },
    unwinnable: { count: records.length - winnableRecords.length, byClass: unwinnableByClass },
    unscored,
    efficiency: {
      passedMedianPlannerCalls: median(passedRecords.map(record => record.plannerCalls)),
      passedMedianToolExecutions: median(passedRecords.map(record => record.toolExecutions)),
      passedMedianDurationMs: median(passedRecords.map(record => record.durationMs)),
    },
  };
}

function emptyClassCounter(): Record<WebArenaFailureClass, number> {
  return { passed: 0, grounding: 0, planner_strategy: 0, budget: 0, recovery: 0, environment_block: 0, evaluator_side: 0 };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
