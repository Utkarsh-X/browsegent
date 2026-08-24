/**
 * Types mirroring the official WebArena task-config schema (config_files/*.json,
 * see web-arena-x/webarena). Field names are kept identical to the upstream format
 * so the official evaluator can consume artifacts without translation.
 */

export type WebArenaSitePlaceholder =
  | '__SHOPPING__'
  | '__SHOPPING_ADMIN__'
  | '__REDDIT__'
  | '__GITLAB__'
  | '__MAP__'
  | '__WIKIPEDIA__';

export interface WebArenaEvalProgramHtml {
  url?: string;
  selector?: string;
  text_or_attr?: string;
}

/** Verbatim shape of the official task config (subset actually consumed here). */
export interface WebArenaTaskConfig {
  task_id: number;
  sites: string[];
  intent_template: string;
  intent_template_id: number;
  intent: string;
  start_url: string;
  geolocation: string | null;
  require_login: boolean;
  storage_state: string;
  require_reset: boolean;
  eval_types: string[];
  reference_answers?: Record<string, unknown>;
  reference_url?: string;
  program_html?: WebArenaEvalProgramHtml[];
  string_note?: string;
  url_note?: string;
}

/**
 * Environment variables that resolve official site placeholders to locally
 * deployed base URLs, e.g. WEBARENA_SHOPPING=http://localhost:7770.
 */
export const WEBARENA_SITE_ENV_VARS: Record<Exclude<WebArenaSitePlaceholder, never>, string> = {
  __SHOPPING__: 'WEBARENA_SHOPPING',
  __SHOPPING_ADMIN__: 'WEBARENA_SHOPPING_ADMIN',
  __REDDIT__: 'WEBARENA_REDDIT',
  __GITLAB__: 'WEBARENA_GITLAB',
  __MAP__: 'WEBARENA_MAP',
  __WIKIPEDIA__: 'WEBARENA_WIKIPEDIA',
};

/** Trajectory artifact handed to the official evaluator bridge. */
export interface WebArenaTrajectoryArtifact {
  taskId: number;
  /** Agent's final answer text (consumed by answer-based eval types such as string_match). */
  answer: string;
  /** Final page URL after the last action (consumed by url_match). */
  finalUrl?: string;
  success: boolean;
  failureReason?: string;
}
