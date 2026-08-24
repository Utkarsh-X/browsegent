import type { BenchmarkTask } from '../types';
import {
  WEBARENA_SITE_ENV_VARS,
  type WebArenaSitePlaceholder,
  type WebArenaTaskConfig,
} from './webarenaTypes';

export interface ResolveWebArenaUrlOptions {
  siteBaseUrls?: Partial<Record<WebArenaSitePlaceholder, string>>;
}

/**
 * Resolves official `__SITE__` placeholders in start_url/reference_url to locally
 * deployed base URLs. Explicit overrides win over environment variables.
 */
export function resolveWebArenaUrl(
  url: string,
  options: ResolveWebArenaUrlOptions = {},
): string {
  const placeholder = Object.keys(WEBARENA_SITE_ENV_VARS).find(candidate => url.startsWith(candidate));
  if (!placeholder) {
    return url;
  }
  const override = options.siteBaseUrls?.[placeholder as WebArenaSitePlaceholder];
  const fromEnv = process.env[WEBARENA_SITE_ENV_VARS[placeholder as WebArenaSitePlaceholder]];
  const base = override ?? (fromEnv?.trim() ? fromEnv.trim() : undefined);
  if (!base) {
    throw new Error(
      `unresolved_webarena_site_placeholder:${placeholder} (set ${WEBARENA_SITE_ENV_VARS[placeholder as WebArenaSitePlaceholder]})`,
    );
  }
  return `${base.replace(/\/$/, '')}${url.slice(placeholder.length)}`;
}

/**
 * Maps one official task config to the shared BenchmarkTask shape. Evaluation
 * metadata stays in the original config — the evaluator bridge consumes it
 * verbatim; nothing here interprets correctness.
 */
export function toBenchmarkTask(config: WebArenaTaskConfig, options: ResolveWebArenaUrlOptions = {}): BenchmarkTask {
  return {
    taskId: `webarena_${config.task_id}`,
    category: config.sites.join('+'),
    difficulty: 'interaction',
    partition: 'holdout',
    url: resolveWebArenaUrl(config.start_url, options),
    goal: config.intent,
    validation: {},
    maxSteps: 15,
  };
}

/**
 * Loads and validates official task configs. Login-gated tasks are kept: the
 * runner satisfies `require_login` with an official storage state (bootstrapAuth),
 * matching upstream semantics. Only predicate misses are excluded, with explicit
 * reasons so nothing is silently dropped.
 */
export function selectPilotTasks(
  configs: WebArenaTaskConfig[],
  predicate: (config: WebArenaTaskConfig) => boolean = defaultPilotPredicate,
): { selected: WebArenaTaskConfig[]; excluded: Array<{ taskId: number; reasons: string[] }> } {
  const selected: WebArenaTaskConfig[] = [];
  const excluded: Array<{ taskId: number; reasons: string[] }> = [];
  for (const config of configs) {
    const reasons: string[] = [];
    if (!predicate(config)) {
      reasons.push('pilot_predicate');
    }
    if (reasons.length === 0) {
      selected.push(config);
    } else {
      excluded.push({ taskId: config.task_id, reasons });
    }
  }
  return { selected, excluded };
}

/** Default pilot filter: shopping-site tasks only, no login, no DOM-program evaluation. */
export function defaultPilotPredicate(config: WebArenaTaskConfig): boolean {
  return config.sites.includes('shopping');
}
