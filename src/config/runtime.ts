import { config as loadDotEnv } from 'dotenv';

loadDotEnv();

export type LlmProvider = 'gemini' | 'cerebras' | 'ollama' | 'openai';

const DEFAULT_PROVIDER: LlmProvider = 'gemini';

export interface LlmSelection {
  provider: LlmProvider;
  model: string;
  modelId: string;
}

export interface RuntimeConfig {
  llm: {
    provider: LlmProvider;
    model: string;
    modelId: string;
    geminiModel: string;
    cerebrasModel: string;
    ollamaModel: string;
    openaiModel: string;
    geminiApiKey?: string;
    cerebrasApiKey?: string;
    openaiApiKey?: string;
    ollamaBaseUrl: string;
  };
  browser: {
    headless: boolean;
    chromePath?: string;
    profileDir: string;
    warmup: boolean;
    maxSteps: number;
    pageWaitMs: number;
  };
  agent: {
    enforceProgressGuards: boolean;
  };
  brain1: {
    interactionPipeline: boolean;
  };
  eval: {
    headless: boolean;
    warmup: boolean;
  };
  logging: {
    dir: string;
  };
}

export function getRuntimeConfig(): RuntimeConfig {
  const provider = getConfiguredProvider();
  const geminiModel = requireEnvString('BROWSEGENT_GEMINI_MODEL');
  const cerebrasModel = requireEnvString('BROWSEGENT_CEREBRAS_MODEL');
  const ollamaModel = requireEnvString('BROWSEGENT_OLLAMA_MODEL');
  const openaiModel = requireEnvString('BROWSEGENT_OPENAI_MODEL');
  const activeModel = getConfiguredModelForProvider(provider, {
    geminiModel,
    cerebrasModel,
    ollamaModel,
    openaiModel,
  });

  return {
    llm: {
      provider,
      model: activeModel,
      modelId: formatProviderModel(provider, activeModel),
      geminiModel,
      cerebrasModel,
      ollamaModel,
      openaiModel,
      geminiApiKey: readEnv('GEMINI_API_KEY'),
      cerebrasApiKey: readEnv('CEREBRAS_API_KEY'),
      openaiApiKey: readEnv('OPENAI_API_KEY'),
      ollamaBaseUrl: getEnvString('BROWSEGENT_OLLAMA_BASE_URL', 'http://127.0.0.1:11434'),
    },
    browser: {
      headless: getEnvBoolean('PHASE6_HEADLESS', true),
      chromePath: readEnv('CHROME_PATH') || undefined,
      profileDir: getEnvString('BROWSEGENT_PROFILE_DIR', 'extension/.chrome_profile_api'),
      warmup: getEnvBoolean('BROWSEGENT_WARMUP', true),
      maxSteps: getEnvNumber('BROWSEGENT_MAX_STEPS', 15),
      pageWaitMs: getEnvNumber('BROWSEGENT_PAGE_WAIT_MS', 5000),
    },
    agent: {
      enforceProgressGuards: getEnvBoolean('BROWSEGENT_ENFORCE_PROGRESS_GUARDS', true),
    },
    brain1: {
      interactionPipeline: getEnvBoolean('BROWSEGENT_BRAIN1_INTERACTION_PIPELINE', true),
    },
    eval: {
      headless: getEnvBoolean('EVAL_HEADLESS', true),
      warmup: getEnvBoolean('EVAL_WARMUP', true),
    },
    logging: {
      dir: getEnvString('LOG_DIR', './logs'),
    },
  };
}

export function getConfiguredProvider(): LlmProvider {
  const raw = readEnv('BROWSEGENT_LLM_PROVIDER') ?? DEFAULT_PROVIDER;
  return normalizeProvider(raw);
}

export function getConfiguredModelForProvider(
  provider: LlmProvider,
  models: {
    geminiModel?: string;
    cerebrasModel?: string;
    ollamaModel?: string;
    openaiModel?: string;
  } = {},
): string {
  switch (provider) {
    case 'gemini':
      return models.geminiModel ?? requireEnvString('BROWSEGENT_GEMINI_MODEL');
    case 'cerebras':
      return models.cerebrasModel ?? requireEnvString('BROWSEGENT_CEREBRAS_MODEL');
    case 'ollama':
      return models.ollamaModel ?? requireEnvString('BROWSEGENT_OLLAMA_MODEL');
    case 'openai':
      return models.openaiModel ?? requireEnvString('BROWSEGENT_OPENAI_MODEL');
  }
}

export function resolveLlmSelection(modelOverride?: string): LlmSelection {
  if (modelOverride && modelOverride.trim()) {
    const trimmed = modelOverride.trim();
    const prefixed = parsePrefixedModel(trimmed);
    if (prefixed) {
      return {
        provider: prefixed.provider,
        model: prefixed.model,
        modelId: formatProviderModel(prefixed.provider, prefixed.model),
      };
    }

    const inferredProvider = inferProviderFromModel(trimmed) ?? getConfiguredProvider();
    return {
      provider: inferredProvider,
      model: trimmed,
      modelId: formatProviderModel(inferredProvider, trimmed),
    };
  }

  const runtime = getRuntimeConfig();
  return {
    provider: runtime.llm.provider,
    model: runtime.llm.model,
    modelId: runtime.llm.modelId,
  };
}

export function formatProviderModel(provider: LlmProvider, model: string): string {
  return `${provider}/${model}`;
}

export function getEnvBoolean(name: string, fallback: boolean): boolean {
  const value = readEnv(name);
  if (value === undefined || value === '') return fallback;
  return value.toLowerCase() !== 'false';
}

export function getEnvString(name: string, fallback: string): string {
  const value = readEnv(name);
  return value === undefined || value === '' ? fallback : value;
}

export function getEnvNumber(name: string, fallback: number): number {
  const value = readEnv(name);
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be a number.`);
  }
  return parsed;
}

function normalizeProvider(value: string): LlmProvider {
  switch (value.toLowerCase()) {
    case 'gemini':
      return 'gemini';
    case 'cerebras':
      return 'cerebras';
    case 'ollama':
      return 'ollama';
    case 'openai':
      return 'openai';
    default:
      throw new Error(`Unsupported BROWSEGENT_LLM_PROVIDER "${value}". Use gemini, cerebras, ollama, or openai.`);
  }
}

function parsePrefixedModel(model: string): { provider: LlmProvider; model: string } | null {
  if (model.startsWith('gemini/')) return { provider: 'gemini', model: model.slice('gemini/'.length) };
  if (model.startsWith('google/gemini/')) return { provider: 'gemini', model: model.slice('google/gemini/'.length) };
  if (model.startsWith('cerebras/')) return { provider: 'cerebras', model: model.slice('cerebras/'.length) };
  if (model.startsWith('ollama/')) return { provider: 'ollama', model: model.slice('ollama/'.length) };
  if (model.startsWith('openai/')) return { provider: 'openai', model: model.slice('openai/'.length) };
  return null;
}

function inferProviderFromModel(model: string): LlmProvider | null {
  if (model.startsWith('gemini')) return 'gemini';
  if (model.startsWith('gpt')) return 'openai';
  if (model.startsWith('qwen')) return 'cerebras';
  return null;
}

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined ? undefined : value.trim();
}

function requireEnvString(name: string): string {
  const value = readEnv(name);
  if (!value) {
    throw new Error(`Environment variable ${name} must be set in .env.`);
  }
  return value;
}
