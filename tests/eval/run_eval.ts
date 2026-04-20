import { config } from 'dotenv';
config();

import fs from 'fs';

import { BrowseGent } from '../../src/BrowseGent';
import { getRuntimeConfig, resolveLlmSelection } from '../../src/config/runtime';

type EvalSuite = 'core' | 'extended' | 'all';
type TaskDifficulty = 'extraction' | 'navigation' | 'reasoning' | 'recovery' | 'adversarial';
type LlmUsageStatus = 'in_range' | 'underuse' | 'overuse';
type EvalFailureType =
  | 'perception_error'
  | 'action_error'
  | 'planning_error'
  | 'environment_block'
  | 'validation_error'
  | 'runtime_crash'
  | 'unknown';

interface LlmExpectationRange {
  min: number;
  max: number;
  target?: number;
}

type LlmExpectation = number | LlmExpectationRange;

interface TaskValidationSpec {
  minLength?: number;
  requireAny?: RegExp[];
  requireAll?: RegExp[];
  forbid?: RegExp[];
}

interface ExpectedAnswerRule {
  name: string;
  matcher: RegExp | string;
  required?: boolean;
}

interface EvalTask {
  id: string;
  category: string;
  difficulty: TaskDifficulty;
  url: string;
  goal: string;
  successCheck: (value: string) => boolean;
  validation?: TaskValidationSpec;
  expectedAnswers?: ExpectedAnswerRule[];
  description: string;
  expectedLlmCalls: LlmExpectation;
}

interface ValueValidationResult {
  passed: boolean;
  reasons: string[];
  preview: string;
}

interface LlmUsageResult {
  expectation: LlmExpectationRange;
  calls: number;
  status: LlmUsageStatus;
  deviationFromTarget?: number;
}

interface TaskResult {
  taskId: string;
  attempt: number;
  category: string;
  difficulty: TaskDifficulty;
  url: string;
  goal: string;
  passed: boolean;
  metExpectedLlmCalls: boolean;
  llmUsage: LlmUsageResult;
  value: string;
  validation: ValueValidationResult;
  failureType?: EvalFailureType;
  failureReason?: string;
  metrics: {
    llmCallCount: number;
    expectedLlmCalls: LlmExpectationRange;
    inputTokens: number;
    outputTokens: number;
    llmDurationMs: number;
    totalSteps: number;
    totalTimeMs: number;
    snapshotNodes: number;
    totalDOMNodes: number;
    snapshotTokens: number;
    attributionRate: number;
    causeBreakdown: Record<string, number>;
    estimatedCostUsd: number;
    model: string;
    progress: {
      assessedActions: number;
      strongActions: number;
      weakActions: number;
      noEffectActions: number;
      noProgressAborts: number;
      decisionCounts: {
        accept: number;
        watch: number;
        warn: number;
        abort: number;
      };
      signalCounts: Record<string, number>;
    };
  };
}

interface EvalReport {
  runId: string;
  timestamp: string;
  model: string;
  suite: EvalSuite;
  repeats: number;
  system: 'browsegent';
  tasks: TaskResult[];
  summary: {
    totalTasks: number;
    uniqueTasks: number;
    passed: number;
    failed: number;
    passRate: number;
    validationFailures: number;
    metLlmExpectations: number;
    llmUsageDistribution: Record<LlmUsageStatus, number>;
    failureTypes: Record<string, number>;
    avgLlmCallsPerTask: number;
    avgSnapshotTokensPerTask: number;
    avgInputTokensPerTask: number;
    totalCostUsd: number;
    avgTimeMs: number;
    byCategory: Record<string, { passed: number; total: number; avgLlmCalls: number }>;
    byDifficulty: Record<string, { passed: number; total: number; avgLlmCalls: number }>;
    stabilityByTask: Record<string, {
      runs: number;
      passes: number;
      passRate: number;
      avgLlmCalls: number;
      failureTypes: Record<string, number>;
    }>;
  };
}

const EXPECT_DETERMINISTIC: LlmExpectationRange = { min: 0, max: 1, target: 0 };
const EXPECT_SIMPLE: LlmExpectationRange = { min: 1, max: 4, target: 2 };
const EXPECT_NAVIGATION: LlmExpectationRange = { min: 2, max: 12, target: 6 };
const EXPECT_DENSE: LlmExpectationRange = { min: 2, max: 15, target: 7 };
const EXPECT_ADVERSARIAL: LlmExpectationRange = { min: 1, max: 8, target: 3 };

const BASE_FORBID_PATTERNS: RegExp[] = [
  /^\s*$/,
  /\berror\b/i,
  /\bblocked\b/i,
  /\bcaptcha\b/i,
  /\baccess denied\b/i,
  /\bunavailable\b/i,
  /\bfailed\b/i,
];

function headingValidation(minLength = 8): TaskValidationSpec {
  return {
    minLength,
    requireAny: [/[A-Za-z]/],
    forbid: [...BASE_FORBID_PATTERNS],
  };
}

function numericValidation(minLength = 1): TaskValidationSpec {
  return {
    minLength,
    requireAny: [/\d/],
    forbid: [...BASE_FORBID_PATTERNS],
  };
}

function priceValidation(): TaskValidationSpec {
  return {
    minLength: 1,
    requireAny: [/\$\s?\d/, /₹\s?\d/, /£\s?\d/, /€\s?\d/, /\b(?:usd|inr|gbp|eur)\b/i, /\d[\d,.]{2,}/],
    forbid: [...BASE_FORBID_PATTERNS, /\bregion not found\b/i],
  };
}

const STRICT_PRICE_TOKEN_PATTERN = /(?:[$₹£€]\s?\d[\d,]*(?:\.\d+)?|\b(?:usd|inr|gbp|eur|aud|cad)\b\s?\d[\d,]*(?:\.\d+)?)/i;
const UNCERTAIN_PRICE_PATTERN = /\b(not explicitly listed|not available|unable to find|cannot determine|could not find|not shown)\b/i;

function strictPriceValidation(): TaskValidationSpec {
  return {
    minLength: 1,
    requireAny: [STRICT_PRICE_TOKEN_PATTERN],
    forbid: [...BASE_FORBID_PATTERNS, /\bregion not found\b/i, UNCERTAIN_PRICE_PATTERN],
  };
}

function hasStrictPriceToken(value: string): boolean {
  return STRICT_PRICE_TOKEN_PATTERN.test(value) && !UNCERTAIN_PRICE_PATTERN.test(value);
}

const CORE_EVAL_TASKS: EvalTask[] = [
  {
    id: 'wikipedia_featured',
    category: 'static_content',
    difficulty: 'extraction',
    url: 'https://en.wikipedia.org/wiki/Main_Page',
    goal: 'Get the title of the featured article on Wikipedia today',
    successCheck: (v) => v.length > 8 && !/error|blocked/i.test(v),
    validation: headingValidation(12),
    description: 'Static DOM baseline.',
    expectedLlmCalls: EXPECT_DETERMINISTIC,
  },
  {
    id: 'hacker_news_top',
    category: 'static_content',
    difficulty: 'extraction',
    url: 'https://news.ycombinator.com/',
    goal: 'Get the title of the first story listed on Hacker News',
    successCheck: (v) => v.length > 8 && !/error|blocked/i.test(v),
    validation: headingValidation(10),
    description: 'Minimal DOM list extraction.',
    expectedLlmCalls: EXPECT_DETERMINISTIC,
  },
  {
    id: 'bbc_headline',
    category: 'static_content',
    difficulty: 'extraction',
    url: 'https://www.bbc.com/news',
    goal: 'Get the main headline from BBC News homepage',
    successCheck: (v) => v.length > 15 && !/error|blocked/i.test(v),
    validation: headingValidation(16),
    description: 'News homepage heading extraction.',
    expectedLlmCalls: EXPECT_SIMPLE,
  },
  {
    id: 'flipkart_pagination',
    category: 'interaction_pagination',
    difficulty: 'navigation',
    url: 'https://www.flipkart.com/search?q=laptop',
    goal: 'Get the price of the first laptop listed after moving to the next page of results',
    successCheck: (v) => hasStrictPriceToken(v),
    validation: strictPriceValidation(),
    description: 'Pagination plus extraction.',
    expectedLlmCalls: EXPECT_NAVIGATION,
  },
  {
    id: 'amazon_global',
    category: 'interaction_dense_grid',
    difficulty: 'reasoning',
    url: 'https://www.amazon.com/s?k=laptop',
    goal: 'Get the price of the first laptop product in the search results',
    successCheck: (v) => hasStrictPriceToken(v),
    validation: strictPriceValidation(),
    description: 'Dense product grid extraction.',
    expectedLlmCalls: EXPECT_DENSE,
  },
  {
    id: 'github_repo_stars',
    category: 'interaction_spa',
    difficulty: 'reasoning',
    url: 'https://github.com/trending',
    goal: 'Get the name and star count of the first trending repository today',
    successCheck: (v) => v.length > 6 && /\d/.test(v),
    validation: {
      minLength: 10,
      requireAll: [/\d/, /\bstars?\b/i],
      forbid: [...BASE_FORBID_PATTERNS],
    },
    description: 'GitHub trending extraction.',
    expectedLlmCalls: EXPECT_SIMPLE,
  },
  {
    id: 'reddit_technology',
    category: 'antibot_social',
    difficulty: 'adversarial',
    url: 'https://www.reddit.com/r/technology',
    goal: 'Get the title of the first technology post visible on this page',
    successCheck: (v) => v.length > 15 && !/error|skip|server/i.test(v),
    validation: headingValidation(18),
    description: 'Social page with anti-bot protections.',
    expectedLlmCalls: EXPECT_ADVERSARIAL,
  },
  {
    id: 'theverge_cloudflare',
    category: 'antibot_cloudflare',
    difficulty: 'adversarial',
    url: 'https://www.theverge.com/',
    goal: 'Get the main headline from The Verge homepage',
    successCheck: (v) => v.length > 10 && !/error|blocked/i.test(v),
    validation: headingValidation(12),
    description: 'Cloudflare-protected homepage.',
    expectedLlmCalls: EXPECT_ADVERSARIAL,
  },
  {
    id: 'vercel_docs',
    category: 'spa_navigation',
    difficulty: 'extraction',
    url: 'https://vercel.com/docs',
    goal: 'Get the main heading from the Vercel documentation page',
    successCheck: (v) => v.length > 3 && !/error/i.test(v),
    validation: headingValidation(8),
    expectedAnswers: [{ name: 'vercel-docs-heading', matcher: /vercel documentation/i, required: false }],
    description: 'SPA docs heading extraction.',
    expectedLlmCalls: EXPECT_DETERMINISTIC,
  },
  {
    id: 'producthunt_today',
    category: 'dynamic_content',
    difficulty: 'reasoning',
    url: 'https://www.producthunt.com/',
    goal: 'Get the name of the first featured product on Product Hunt today',
    successCheck: (v) => v.length > 3 && !/error|blocked/i.test(v),
    validation: headingValidation(5),
    description: 'Dynamic homepage extraction.',
    expectedLlmCalls: EXPECT_SIMPLE,
  },
];

const EXTENDED_EVAL_TASKS: EvalTask[] = [
  {
    id: 'ext_python_json_defaults',
    category: 'docs_reference',
    difficulty: 'reasoning',
    url: 'https://docs.python.org/3/library/json.html',
    goal: 'What are the default parameters of json.dumps() function?',
    successCheck: (v) => v.length > 10 && !/error|blocked/i.test(v),
    validation: {
      minLength: 14,
      requireAny: [/json\.dumps/i, /skipkeys|ensure_ascii|indent|separators|sort_keys|default|allow_nan/i],
      forbid: [...BASE_FORBID_PATTERNS],
    },
    description: 'Python docs signature extraction.',
    expectedLlmCalls: EXPECT_NAVIGATION,
  },
  {
    id: 'ext_mdn_fetch_api',
    category: 'docs_reference',
    difficulty: 'extraction',
    url: 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API',
    goal: 'Get the main heading of this MDN page.',
    successCheck: (v) => v.length > 5 && !/error|blocked/i.test(v),
    validation: headingValidation(8),
    expectedAnswers: [{ name: 'mdn-fetch-heading', matcher: /fetch api/i, required: false }],
    description: 'MDN heading extraction.',
    expectedLlmCalls: EXPECT_SIMPLE,
  },
  {
    id: 'ext_nodejs_fs_heading',
    category: 'docs_reference',
    difficulty: 'extraction',
    url: 'https://nodejs.org/docs/latest/api/fs.html',
    goal: 'Get the top heading from this Node.js fs API page.',
    successCheck: (v) => v.length > 3 && !/error|blocked/i.test(v),
    validation: headingValidation(5),
    expectedAnswers: [{ name: 'node-fs-heading', matcher: /\bfs\b/i, required: false }],
    description: 'Node.js API heading extraction.',
    expectedLlmCalls: EXPECT_SIMPLE,
  },
  {
    id: 'ext_npm_react_version',
    category: 'docs_reference',
    difficulty: 'extraction',
    url: 'https://www.npmjs.com/package/react',
    goal: 'Get the current version number shown for the React package.',
    successCheck: (v) => /\d+\.\d+\.\d+/.test(v),
    validation: {
      minLength: 3,
      requireAny: [/\d+\.\d+\.\d+/],
      forbid: [...BASE_FORBID_PATTERNS],
    },
    description: 'NPM package metadata extraction.',
    expectedLlmCalls: EXPECT_SIMPLE,
  },
  {
    id: 'ext_wikipedia_moonwalkers_count',
    category: 'knowledge_reference',
    difficulty: 'reasoning',
    url: 'https://en.wikipedia.org/wiki/Moon_landing',
    goal: 'How many people have walked on the Moon in total?',
    successCheck: (v) => /\d+|twelve/i.test(v) && !/error|blocked/i.test(v),
    validation: numericValidation(1),
    expectedAnswers: [{ name: 'moonwalkers-count', matcher: /\b12\b|\btwelve\b/i, required: false }],
    description: 'Long-article factual extraction.',
    expectedLlmCalls: EXPECT_SIMPLE,
  },
  {
    id: 'ext_github_vscode_license',
    category: 'knowledge_reference',
    difficulty: 'extraction',
    url: 'https://github.com/microsoft/vscode',
    goal: 'What license does this repository use?',
    successCheck: (v) => /license|mit|apache|bsd|gpl/i.test(v),
    validation: {
      minLength: 3,
      requireAny: [/license/i, /mit/i, /apache/i, /bsd/i, /gpl/i],
      forbid: [...BASE_FORBID_PATTERNS],
    },
    expectedAnswers: [{ name: 'vscode-license', matcher: /\bmit\b/i, required: false }],
    description: 'Repository metadata extraction.',
    expectedLlmCalls: EXPECT_SIMPLE,
  },
  {
    id: 'ext_apnews_main_headline',
    category: 'news_homepage',
    difficulty: 'adversarial',
    url: 'https://apnews.com/',
    goal: 'What is the main headline story on AP News right now?',
    successCheck: (v) => v.length > 10 && !/error|blocked/i.test(v),
    validation: headingValidation(12),
    description: 'Dynamic news homepage extraction.',
    expectedLlmCalls: EXPECT_ADVERSARIAL,
  },
  {
    id: 'ext_stackoverflow_js_count',
    category: 'forum_metadata',
    difficulty: 'reasoning',
    url: 'https://stackoverflow.com/questions/tagged/javascript',
    goal: 'How many questions are tagged with javascript on Stack Overflow?',
    successCheck: (v) => /\d/.test(v) && !/error|blocked/i.test(v),
    validation: numericValidation(1),
    description: 'Community metadata extraction.',
    expectedLlmCalls: EXPECT_NAVIGATION,
  },
  {
    id: 'ext_indeed_first_company',
    category: 'jobs_listing',
    difficulty: 'reasoning',
    url: 'https://www.indeed.com/jobs?q=python+developer&l=remote',
    goal: 'What company posted the first job listing shown?',
    successCheck: (v) => v.length > 2 && !/error|blocked|captcha/i.test(v),
    validation: headingValidation(3),
    description: 'Job card entity extraction.',
    expectedLlmCalls: EXPECT_ADVERSARIAL,
  },
  {
    id: 'ext_weathergov_first_alert',
    category: 'institutional_data',
    difficulty: 'extraction',
    url: 'https://weather.gov/',
    goal: 'What is the title of the first weather alert or headline shown on the page?',
    successCheck: (v) => v.length > 5 && !/error|blocked/i.test(v),
    validation: headingValidation(8),
    description: 'Government weather alert extraction.',
    expectedLlmCalls: EXPECT_SIMPLE,
  },
  {
    id: 'ext_nasa_featured_story',
    category: 'institutional_data',
    difficulty: 'extraction',
    url: 'https://www.nasa.gov/',
    goal: 'What is the featured story or main article title on NASA homepage?',
    successCheck: (v) => v.length > 8 && !/error|blocked/i.test(v),
    validation: headingValidation(10),
    description: 'Institutional hero-story extraction.',
    expectedLlmCalls: EXPECT_SIMPLE,
  },
  {
    id: 'ext_espn_top_headline',
    category: 'news_homepage',
    difficulty: 'adversarial',
    url: 'https://www.espn.com/',
    goal: 'What is the top sports headline shown on ESPN right now?',
    successCheck: (v) => v.length > 8 && !/error|blocked/i.test(v),
    validation: headingValidation(10),
    description: 'Sports headline extraction.',
    expectedLlmCalls: EXPECT_ADVERSARIAL,
  },
  {
    id: 'ext_newegg_usb_hub_price',
    category: 'product_listing',
    difficulty: 'reasoning',
    url: 'https://www.newegg.com/p/pl?d=usb+hub',
    goal: 'What is the price of the first product listed?',
    successCheck: (v) => /[$EURGBPINRUSD₹£€]?\s?\d[\d,.]*/i.test(v) && !/error|blocked|captcha/i.test(v),
    validation: priceValidation(),
    description: 'Product listing first-price extraction.',
    expectedLlmCalls: EXPECT_DENSE,
  },
  {
    id: 'ext_ebay_laptop_price',
    category: 'product_listing',
    difficulty: 'reasoning',
    url: 'https://www.ebay.com/sch/i.html?_nkw=laptop',
    goal: 'Get the price of the first laptop listing shown.',
    successCheck: (v) => /[$EURGBPINRUSD₹£€]?\s?\d[\d,.]*/i.test(v) && !/error|blocked|captcha/i.test(v),
    validation: priceValidation(),
    description: 'Marketplace listing extraction.',
    expectedLlmCalls: EXPECT_DENSE,
  },
  {
    id: 'ext_reuters_world_headline',
    category: 'news_homepage',
    difficulty: 'adversarial',
    url: 'https://www.reuters.com/world/',
    goal: 'Get the first main world-news headline shown on this page.',
    successCheck: (v) => v.length > 10 && !/error|blocked/i.test(v),
    validation: headingValidation(12),
    description: 'News section extraction.',
    expectedLlmCalls: EXPECT_ADVERSARIAL,
  },
  {
    id: 'ext_arxiv_cs_recent_title',
    category: 'research_feed',
    difficulty: 'extraction',
    url: 'https://arxiv.org/list/cs/recent',
    goal: 'Get the title of the first paper listed in cs recent submissions.',
    successCheck: (v) => v.length > 10 && !/error|blocked/i.test(v),
    validation: headingValidation(12),
    description: 'Research feed extraction.',
    expectedLlmCalls: EXPECT_SIMPLE,
  },
  {
    id: 'ext_cdc_home_headline',
    category: 'institutional_data',
    difficulty: 'extraction',
    url: 'https://www.cdc.gov/',
    goal: 'Get the main headline or featured story title shown on the CDC homepage.',
    successCheck: (v) => v.length > 8 && !/error|blocked/i.test(v),
    validation: headingValidation(10),
    description: 'Public health homepage extraction.',
    expectedLlmCalls: EXPECT_SIMPLE,
  },
  {
    id: 'ext_usgs_earthquake_headline',
    category: 'institutional_data',
    difficulty: 'extraction',
    url: 'https://www.usgs.gov/programs/earthquake-hazards',
    goal: 'Get the first prominent headline on the USGS earthquake hazards page.',
    successCheck: (v) => v.length > 8 && !/error|blocked/i.test(v),
    validation: headingValidation(10),
    description: 'Government program page extraction.',
    expectedLlmCalls: EXPECT_SIMPLE,
  },
  {
    id: 'ext_who_home_headline',
    category: 'institutional_data',
    difficulty: 'extraction',
    url: 'https://www.who.int/',
    goal: 'Get the first prominent headline on the WHO homepage.',
    successCheck: (v) => v.length > 8 && !/error|blocked/i.test(v),
    validation: headingValidation(10),
    description: 'International institution homepage extraction.',
    expectedLlmCalls: EXPECT_SIMPLE,
  },
  {
    id: 'ext_nytimes_main_headline',
    category: 'news_homepage',
    difficulty: 'adversarial',
    url: 'https://www.nytimes.com/',
    goal: 'Get the main headline shown on the New York Times homepage.',
    successCheck: (v) => v.length > 8 && !/error|blocked/i.test(v),
    validation: headingValidation(10),
    description: 'Paywall-prone dynamic headline extraction.',
    expectedLlmCalls: EXPECT_ADVERSARIAL,
  },
];

const STRICT_PRICE_TASK_IDS = new Set([
  'flipkart_pagination',
  'amazon_global',
  'ext_newegg_usb_hub_price',
  'ext_ebay_laptop_price',
]);

for (const task of [...CORE_EVAL_TASKS, ...EXTENDED_EVAL_TASKS]) {
  if (!STRICT_PRICE_TASK_IDS.has(task.id)) {
    continue;
  }
  task.successCheck = (value) => hasStrictPriceToken(value) && !/error|blocked|captcha/i.test(value);
  task.validation = strictPriceValidation();
}

const ALL_EVAL_TASKS: EvalTask[] = [...CORE_EVAL_TASKS, ...EXTENDED_EVAL_TASKS];

const SUITE_TASKS: Record<EvalSuite, EvalTask[]> = {
  core: CORE_EVAL_TASKS,
  extended: EXTENDED_EVAL_TASKS,
  all: ALL_EVAL_TASKS,
};

function parseEvalSuite(raw?: string | null): EvalSuite {
  const normalized = (raw ?? 'core').trim().toLowerCase();
  if (normalized === 'core' || normalized === 'extended' || normalized === 'all') {
    return normalized;
  }
  throw new Error(`Invalid --suite "${raw}". Expected one of: core, extended, all.`);
}

function parseRepeatCount(raw?: string | null): number {
  if (!raw) return 1;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 10) {
    throw new Error(`Invalid --repeat "${raw}". Expected integer 1..10.`);
  }
  return n;
}

function resolveLlmExpectation(expectation: LlmExpectation): LlmExpectationRange {
  if (typeof expectation === 'number') {
    if (expectation <= 0) return { min: 0, max: 1, target: 0 };
    return { min: Math.max(1, expectation - 1), max: expectation + 3, target: expectation };
  }
  return expectation;
}

function evaluateLlmUsage(calls: number, expectation: LlmExpectation): LlmUsageResult {
  const resolved = resolveLlmExpectation(expectation);
  let status: LlmUsageStatus = 'in_range';
  if (calls < resolved.min) status = 'underuse';
  if (calls > resolved.max) status = 'overuse';
  return {
    expectation: resolved,
    calls,
    status,
    deviationFromTarget: resolved.target !== undefined ? calls - resolved.target : undefined,
  };
}

function testMatcher(value: string, matcher: string | RegExp): boolean {
  if (matcher instanceof RegExp) {
    return matcher.test(value);
  }
  return value.toLowerCase().includes(matcher.toLowerCase());
}

function validateTaskValue(task: EvalTask, value: string): ValueValidationResult {
  const trimmed = value.trim();
  const reasons: string[] = [];

  let successCheckPass = false;
  try {
    successCheckPass = task.successCheck(trimmed);
  } catch (err) {
    reasons.push(`successCheck threw: ${String(err)}`);
  }
  if (!successCheckPass) {
    reasons.push('successCheck failed');
  }

  const spec = task.validation;
  if (spec) {
    if (typeof spec.minLength === 'number' && trimmed.length < spec.minLength) {
      reasons.push(`value shorter than minLength=${spec.minLength}`);
    }
    if (spec.requireAny && spec.requireAny.length > 0) {
      const anyMatched = spec.requireAny.some((pattern) => pattern.test(trimmed));
      if (!anyMatched) {
        reasons.push(`none of requireAny patterns matched (${spec.requireAny.length})`);
      }
    }
    if (spec.requireAll && spec.requireAll.length > 0) {
      const missing = spec.requireAll.filter((pattern) => !pattern.test(trimmed));
      if (missing.length > 0) {
        reasons.push(`missing requireAll matches (${missing.length}/${spec.requireAll.length})`);
      }
    }
    if (spec.forbid && spec.forbid.length > 0) {
      const matchedForbidden = spec.forbid.filter((pattern) => pattern.test(trimmed));
      if (matchedForbidden.length > 0) {
        reasons.push(`matched forbidden pattern(s) (${matchedForbidden.length})`);
      }
    }
  }

  if (task.expectedAnswers && task.expectedAnswers.length > 0) {
    for (const rule of task.expectedAnswers) {
      const matched = testMatcher(trimmed, rule.matcher);
      if (!matched && rule.required !== false) {
        reasons.push(`expected answer rule failed: ${rule.name}`);
      }
    }
  }

  return {
    passed: reasons.length === 0,
    reasons: Array.from(new Set(reasons)),
    preview: trimmed.slice(0, 160),
  };
}

function classifyCrashFailure(errStr: string): EvalFailureType {
  const text = errStr.toLowerCase();
  if (
    text.includes('api_quota_exceeded')
    || text.includes('resource_exhausted')
    || text.includes('429')
    || text.includes('503')
    || text.includes('timeout')
    || text.includes('net::err')
    || text.includes('enotfound')
    || text.includes('econnreset')
  ) {
    return 'environment_block';
  }
  return 'runtime_crash';
}

function classifyTaskFailure(
  runSuccess: boolean,
  failureReason: string | undefined,
  validation: ValueValidationResult,
  progress: TaskResult['metrics']['progress'],
  crashError?: string
): EvalFailureType {
  if (crashError) {
    return classifyCrashFailure(crashError);
  }

  const reason = (failureReason ?? '').toLowerCase();

  if (runSuccess && !validation.passed) {
    if (progress.assessedActions === 0) return 'perception_error';
    if (progress.noEffectActions >= 2 && progress.strongActions === 0) return 'action_error';
    return 'validation_error';
  }

  if (!runSuccess) {
    if (
      reason.includes('captcha')
      || reason.includes('user input required')
      || reason.includes('blocked')
      || reason.includes('verification')
      || reason.includes('consent')
      || reason.includes('403')
      || reason.includes('429')
      || reason.includes('503')
      || reason.includes('fetch failed')
      || reason.includes('econnreset')
      || reason.includes('resource_exhausted')
    ) {
      return 'environment_block';
    }
    if (
      reason.includes('no_progress_detected')
      || reason.includes('max_steps_exceeded')
      || reason.includes('dead end')
      || reason.includes('llm response unusable')
    ) {
      return 'planning_error';
    }
    if (progress.noEffectActions >= 2 && progress.strongActions === 0) {
      return 'action_error';
    }
    if (progress.weakActions > progress.strongActions && progress.assessedActions > 0) {
      return 'perception_error';
    }
    return 'unknown';
  }

  return 'unknown';
}

function logAvailableTasks(suite: EvalSuite): void {
  const tasks = SUITE_TASKS[suite];
  console.log(`\nAvailable tasks for suite="${suite}" (${tasks.length}):`);
  for (const task of tasks) {
    const expectation = resolveLlmExpectation(task.expectedLlmCalls);
    console.log(`- ${task.id} [${task.category}] difficulty=${task.difficulty} llm=${expectation.min}-${expectation.max}`);
  }
  console.log('');
}

async function runEval(
  modelOverride?: string,
  taskFilter?: string | null,
  suite: EvalSuite = 'core',
  repeatCount = 1
): Promise<void> {
  const runtime = getRuntimeConfig();
  const llmSelection = resolveLlmSelection(modelOverride);
  const model = llmSelection.modelId;
  const headless = runtime.eval.headless;
  const warmup = runtime.eval.warmup;
  const suiteTasks = SUITE_TASKS[suite];

  const runId = `${Date.now()}_${suite}_r${repeatCount}_${model.replace(/[^a-z0-9]/gi, '_')}`;
  const runDir = `logs/eval_runs/${runId}`;
  fs.mkdirSync(runDir, { recursive: true });
  process.env.LOG_DIR = runDir;

  const tasksToRun = taskFilter
    ? suiteTasks.filter((t) => t.id === taskFilter)
    : suiteTasks;

  if (taskFilter && tasksToRun.length === 0) {
    console.error(`Task "${taskFilter}" not found in suite "${suite}".`);
    logAvailableTasks(suite);
    process.exit(1);
  }

  console.log('\n================================================');
  console.log('  BrowseGent - Global Evaluation Suite (Hardened)');
  console.log('================================================');
  console.log(`  Model:    ${model}`);
  console.log(`  Suite:    ${suite}`);
  console.log(`  Repeat:   ${repeatCount}`);
  console.log(`  Guards:   ${runtime.agent.enforceProgressGuards ? 'enforced' : 'telemetry-only'}`);
  console.log(`  Tasks:    ${tasksToRun.length}${taskFilter ? ` (filtered: ${taskFilter})` : ''}`);
  console.log(`  RunID:    ${runId}`);
  console.log(`  Headless: ${headless}`);
  console.log(`  Warmup:   ${warmup}\n`);

  const bg = new BrowseGent({ model, headless, warmup });
  await bg.init();

  const results: TaskResult[] = [];

  for (let attempt = 1; attempt <= repeatCount; attempt++) {
    if (repeatCount > 1) {
      console.log(`\n================ Attempt ${attempt}/${repeatCount} ================`);
    }
    for (let i = 0; i < tasksToRun.length; i++) {
      const task = tasksToRun[i]!;
      console.log(`\n  [${i + 1}/${tasksToRun.length}] ${task.id} (attempt ${attempt})`);
      console.log(`  ${task.url}`);
      console.log(`  Goal: ${task.goal}`);

      try {
        const result = await bg.run(task.url, task.goal);
        const validation = validateTaskValue(task, result.value);
        const llmUsage = evaluateLlmUsage(result.metrics.llmCallCount, task.expectedLlmCalls);
        const passed = result.success && validation.passed;
        const metExpected = llmUsage.status === 'in_range';
        const failureType = passed
          ? undefined
          : classifyTaskFailure(result.success, result.failureReason, validation, result.metrics.progress);

        console.log(
          `  -> ${passed ? 'PASS' : 'FAIL'} | LLM: ${result.metrics.llmCallCount} (range ${llmUsage.expectation.min}-${llmUsage.expectation.max}) ${metExpected ? 'OK' : llmUsage.status.toUpperCase()}`
        );
        console.log(`  -> Value: "${validation.preview}"`);
        if (!validation.passed) {
          console.log(`  -> Validation: FAIL (${validation.reasons.join('; ')})`);
        }
        if (!passed) {
          console.log(`  -> FailureType: ${failureType ?? 'unknown'}`);
          if (result.failureReason) {
            console.log(`  -> FailureReason: ${result.failureReason}`);
          }
        }
        console.log(
          `  -> Tokens: ${result.metrics.snapshotTokens} graph | ${result.metrics.inputTokens}in ${result.metrics.outputTokens}out LLM`
        );
        console.log(
          `  -> Time: ${result.metrics.totalTimeMs}ms | Cost: $${result.metrics.estimatedCostUsd.toFixed(6)}`
        );
        console.log(
          `  -> Progress: ${result.metrics.progress.strongActions} strong | ${result.metrics.progress.weakActions} weak | ${result.metrics.progress.noEffectActions} none | aborts ${result.metrics.progress.noProgressAborts}`
        );

        results.push({
          taskId: task.id,
          attempt,
          category: task.category,
          difficulty: task.difficulty,
          url: task.url,
          goal: task.goal,
          passed,
          metExpectedLlmCalls: metExpected,
          llmUsage,
          value: result.value,
          validation,
          failureType,
          failureReason: result.failureReason,
          metrics: {
            llmCallCount: result.metrics.llmCallCount,
            expectedLlmCalls: llmUsage.expectation,
            inputTokens: result.metrics.inputTokens,
            outputTokens: result.metrics.outputTokens,
            llmDurationMs: result.metrics.llmDurationMs,
            totalSteps: result.metrics.totalSteps,
            totalTimeMs: result.metrics.totalTimeMs,
            snapshotNodes: result.metrics.snapshotNodes,
            totalDOMNodes: result.metrics.totalDOMNodes,
            snapshotTokens: result.metrics.snapshotTokens,
            attributionRate: result.metrics.attributionRate,
            causeBreakdown: result.metrics.causeBreakdown,
            estimatedCostUsd: result.metrics.estimatedCostUsd,
            model,
            progress: result.metrics.progress,
          },
        });
      } catch (err) {
        const errStr = err instanceof Error ? `${err.name}: ${err.message}` : String(err);

        if (
          errStr.includes('API_QUOTA_EXCEEDED')
          || errStr.includes('429')
          || errStr.includes('RESOURCE_EXHAUSTED')
        ) {
          console.error(`\n  QUOTA EXCEEDED on task ${task.id}`);
          console.error(`  Switch active provider key in .env and re-run with: --task ${task.id}`);
          console.error(`  Partial results saved to ${runDir}`);
          await bg.close();
          saveReport(results, runId, runDir, model, suite, repeatCount);
          process.exit(1);
        }

        const llmUsage = evaluateLlmUsage(0, task.expectedLlmCalls);
        const validation: ValueValidationResult = {
          passed: false,
          reasons: ['run crashed before value validation'],
          preview: '',
        };
        const failureType = classifyTaskFailure(
          false,
          `crash: ${errStr}`,
          validation,
          {
            assessedActions: 0,
            strongActions: 0,
            weakActions: 0,
            noEffectActions: 0,
            noProgressAborts: 0,
            decisionCounts: { accept: 0, watch: 0, warn: 0, abort: 0 },
            signalCounts: {},
          },
          errStr
        );

        console.log(`  -> CRASH: ${errStr.slice(0, 160)}`);
        console.log(`  -> FailureType: ${failureType}`);

        results.push({
          taskId: task.id,
          attempt,
          category: task.category,
          difficulty: task.difficulty,
          url: task.url,
          goal: task.goal,
          passed: false,
          metExpectedLlmCalls: false,
          llmUsage,
          value: '',
          validation,
          failureType,
          failureReason: `crash: ${errStr.slice(0, 300)}`,
          metrics: {
            llmCallCount: 0,
            expectedLlmCalls: llmUsage.expectation,
            inputTokens: 0,
            outputTokens: 0,
            llmDurationMs: 0,
            totalSteps: 0,
            totalTimeMs: 0,
            snapshotNodes: 0,
            totalDOMNodes: 0,
            snapshotTokens: 0,
            attributionRate: 0,
            causeBreakdown: {},
            estimatedCostUsd: 0,
            model,
            progress: {
              assessedActions: 0,
              strongActions: 0,
              weakActions: 0,
              noEffectActions: 0,
              noProgressAborts: 0,
              decisionCounts: { accept: 0, watch: 0, warn: 0, abort: 0 },
              signalCounts: {},
            },
          },
        });
      }
    }
  }

  await bg.close();
  saveReport(results, runId, runDir, model, suite, repeatCount);
}

function saveReport(
  results: TaskResult[],
  runId: string,
  runDir: string,
  model: string,
  suite: EvalSuite,
  repeatCount: number
): void {
  const passed = results.filter((r) => r.passed).length;
  const metExpected = results.filter((r) => r.metExpectedLlmCalls).length;
  const validationFailures = results.filter((r) => !r.validation.passed).length;
  const llmUsageDistribution: Record<LlmUsageStatus, number> = {
    in_range: 0,
    underuse: 0,
    overuse: 0,
  };
  const failureTypes: Record<string, number> = {};
  const byCategory: Record<string, { passed: number; total: number; avgLlmCalls: number }> = {};
  const byDifficulty: Record<string, { passed: number; total: number; avgLlmCalls: number }> = {};
  const stabilityByTask: Record<string, {
    runs: number;
    passes: number;
    passRate: number;
    avgLlmCalls: number;
    failureTypes: Record<string, number>;
  }> = {};

  for (const r of results) {
    llmUsageDistribution[r.llmUsage.status]++;

    if (r.failureType) {
      failureTypes[r.failureType] = (failureTypes[r.failureType] ?? 0) + 1;
    }

    if (!byCategory[r.category]) byCategory[r.category] = { passed: 0, total: 0, avgLlmCalls: 0 };
    byCategory[r.category]!.total++;
    byCategory[r.category]!.avgLlmCalls += r.metrics.llmCallCount;
    if (r.passed) byCategory[r.category]!.passed++;

    if (!byDifficulty[r.difficulty]) byDifficulty[r.difficulty] = { passed: 0, total: 0, avgLlmCalls: 0 };
    byDifficulty[r.difficulty]!.total++;
    byDifficulty[r.difficulty]!.avgLlmCalls += r.metrics.llmCallCount;
    if (r.passed) byDifficulty[r.difficulty]!.passed++;

    if (!stabilityByTask[r.taskId]) {
      stabilityByTask[r.taskId] = {
        runs: 0,
        passes: 0,
        passRate: 0,
        avgLlmCalls: 0,
        failureTypes: {},
      };
    }
    stabilityByTask[r.taskId]!.runs++;
    stabilityByTask[r.taskId]!.avgLlmCalls += r.metrics.llmCallCount;
    if (r.passed) stabilityByTask[r.taskId]!.passes++;
    if (r.failureType) {
      stabilityByTask[r.taskId]!.failureTypes[r.failureType]
        = (stabilityByTask[r.taskId]!.failureTypes[r.failureType] ?? 0) + 1;
    }
  }

  for (const c of Object.values(byCategory)) c.avgLlmCalls /= c.total;
  for (const d of Object.values(byDifficulty)) d.avgLlmCalls /= d.total;
  for (const taskStat of Object.values(stabilityByTask)) {
    taskStat.passRate = taskStat.runs > 0 ? taskStat.passes / taskStat.runs : 0;
    taskStat.avgLlmCalls /= taskStat.runs || 1;
  }

  const uniqueTasks = new Set(results.map((r) => r.taskId)).size;

  const report: EvalReport = {
    runId,
    timestamp: new Date().toISOString(),
    model,
    suite,
    repeats: repeatCount,
    system: 'browsegent',
    tasks: results,
    summary: {
      totalTasks: results.length,
      uniqueTasks,
      passed,
      failed: results.length - passed,
      passRate: results.length > 0 ? passed / results.length : 0,
      validationFailures,
      metLlmExpectations: metExpected,
      llmUsageDistribution,
      failureTypes,
      avgLlmCallsPerTask: results.reduce((a, r) => a + r.metrics.llmCallCount, 0) / (results.length || 1),
      avgSnapshotTokensPerTask: results.reduce((a, r) => a + r.metrics.snapshotTokens, 0) / (results.length || 1),
      avgInputTokensPerTask: results.reduce((a, r) => a + r.metrics.inputTokens, 0) / (results.length || 1),
      totalCostUsd: results.reduce((a, r) => a + r.metrics.estimatedCostUsd, 0),
      avgTimeMs: results.reduce((a, r) => a + r.metrics.totalTimeMs, 0) / (results.length || 1),
      byCategory,
      byDifficulty,
      stabilityByTask,
    },
  };

  const reportPath = `${runDir}/report.json`;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log('\n================================================');
  console.log('  EVALUATION SUMMARY');
  console.log('================================================');
  console.log(`  RunID:              ${runId}`);
  console.log(`  Model:              ${model}`);
  console.log(`  Suite:              ${suite}`);
  console.log(`  Repeat:             ${repeatCount}`);
  console.log(`  Unique tasks:       ${uniqueTasks}`);
  console.log(`  Executions:         ${results.length}`);
  console.log(`  Pass rate:          ${(report.summary.passRate * 100).toFixed(1)}% (${passed}/${results.length})`);
  console.log(`  Validation failures:${validationFailures}`);
  console.log(`  LLM in-range:       ${metExpected}/${results.length}`);
  console.log(
    `  LLM usage bands:    in_range=${llmUsageDistribution.in_range}, underuse=${llmUsageDistribution.underuse}, overuse=${llmUsageDistribution.overuse}`
  );
  console.log(`  Avg LLM calls:      ${report.summary.avgLlmCallsPerTask.toFixed(2)} per task`);
  console.log(`  Avg graph tokens:   ${report.summary.avgSnapshotTokensPerTask.toFixed(0)} (Brain 1 output)`);
  console.log(`  Avg LLM tokens in:  ${report.summary.avgInputTokensPerTask.toFixed(0)}`);
  console.log(`  Total cost:         $${report.summary.totalCostUsd.toFixed(5)}`);
  console.log(`  Avg time:           ${(report.summary.avgTimeMs / 1000).toFixed(1)}s`);
  console.log('\n  By difficulty:');
  for (const [difficulty, { passed: p, total: t, avgLlmCalls }] of Object.entries(byDifficulty)) {
    console.log(`    ${difficulty}: ${p}/${t} | ${avgLlmCalls.toFixed(1)} avg LLM calls`);
  }
  console.log('\n  Failure types:');
  const failureEntries = Object.entries(failureTypes);
  if (failureEntries.length === 0) {
    console.log('    none');
  } else {
    for (const [failureType, count] of failureEntries) {
      console.log(`    ${failureType}: ${count}`);
    }
  }
  console.log(`\n  Report -> ${reportPath}`);
  console.log('================================================\n');
}

const modelArg = process.argv[2];
const taskFilterIdx = process.argv.indexOf('--task');
const taskFilter = taskFilterIdx !== -1 ? process.argv[taskFilterIdx + 1] ?? null : null;
const suiteIdx = process.argv.indexOf('--suite');
const suiteArg = suiteIdx !== -1 ? process.argv[suiteIdx + 1] ?? null : null;
const repeatIdx = process.argv.indexOf('--repeat');
const repeatArg = repeatIdx !== -1 ? process.argv[repeatIdx + 1] ?? null : null;
const listOnly = process.argv.includes('--list');

let suite: EvalSuite;
let repeatCount: number;
try {
  suite = parseEvalSuite(suiteArg);
  repeatCount = parseRepeatCount(repeatArg);
} catch (err) {
  console.error(String(err));
  process.exit(1);
}

if (listOnly) {
  logAvailableTasks(suite);
  process.exit(0);
}

runEval(modelArg, taskFilter, suite, repeatCount).catch((err) => {
  console.error('Eval crashed:', err);
  process.exit(1);
});
