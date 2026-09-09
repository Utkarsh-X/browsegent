/**
 * Types mirroring the official WebArena task-config schema (config_files/*.json,
 * see web-arena-x/webarena). Field names and nesting are kept identical to the
 * upstream format so pinned manifests round-trip into the official evaluator
 * without translation.
 */

export type WebArenaSitePlaceholder =
  | '__SHOPPING__'
  | '__SHOPPING_ADMIN__'
  | '__REDDIT__'
  | '__GITLAB__'
  | '__MAP__'
  | '__WIKIPEDIA__';

/** Upstream eval.program_html entry: read a live DOM node and compare contents. */
export interface WebArenaProgramHtmlTarget {
  /** Absolute/placeholder URL to navigate to, `last` (stay on final page), or `func:...`. */
  url: string;
  /** JS element locator (`document....`), empty for full page, or `func:<helper>(page)`. */
  locator: string;
  required_contents: {
    exact_match?: string;
    must_include?: string[];
  };
}

/** Upstream nests all evaluation metadata under `eval`; consumed verbatim by the official evaluator. */
export interface WebArenaTaskEval {
  eval_types?: string[];
  reference_answers?: Record<string, unknown>;
  reference_url?: string;
  program_html?: WebArenaProgramHtmlTarget[];
  string_note?: string;
  url_note?: string;
  reference_answer_raw_annotation?: string;
}

/** Verbatim shape of one official task config entry in test.raw.json. */
export interface WebArenaTaskConfig {
  task_id: number;
  sites: string[];
  require_login: boolean;
  storage_state: string;
  start_url: string;
  geolocation: string | null;
  intent_template: string;
  instantiation_dict?: Record<string, unknown>;
  intent: string;
  require_reset: boolean;
  eval: WebArenaTaskEval;
  intent_template_id: number;
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

/**
 * Official env var names upstream's browser_env.env_config asserts on import.
 * The evaluator bridge maps our resolved site URLs onto these before spawning Python.
 */
export const OFFICIAL_SITE_ENV_VARS: Record<Exclude<WebArenaSitePlaceholder, never>, string> = {
  __SHOPPING__: 'SHOPPING',
  __SHOPPING_ADMIN__: 'SHOPPING_ADMIN',
  __REDDIT__: 'REDDIT',
  __GITLAB__: 'GITLAB',
  __MAP__: 'MAP',
  __WIKIPEDIA__: 'WIKIPEDIA',
};

/** Trajectory artifact handed to the official evaluator bridge. */
export interface WebArenaTrajectoryArtifact {
  taskId: number;
  /** Agent's final answer text (consumed by answer-based eval types such as string_match). */
  answer: string;
  /** Final page URL after the last action (consumed by url_match and `__last_url__` targets). */
  finalUrl?: string;
  success: boolean;
  failureReason?: string;
}
