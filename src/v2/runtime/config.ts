import type { V2RuntimeConfig, V2RuntimeMode } from './types';
import { V2OperationalError } from './errors';

export class V2RuntimeConfigError extends V2OperationalError {
  constructor(message: string) {
    super('invalid_runtime_mode', message, { retryable: false });
    this.name = 'V2RuntimeConfigError';
  }
}

export function loadV2RuntimeConfig(env: NodeJS.ProcessEnv = process.env): V2RuntimeConfig {
  return {
    v2RuntimeMode: normalizeV2RuntimeMode(readEnv(env, 'BROWSEGENT_V2_RUNTIME') ?? 'off'),
    traceDir: readEnv(env, 'BROWSEGENT_V2_TRACE_DIR') ?? 'logs/v2-runs',
    headed: readBoolean(env, 'BROWSEGENT_V2_HEADED', false),
  };
}

function normalizeV2RuntimeMode(value: string): V2RuntimeMode {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'off' || normalized === 'mvr' || normalized === 'agent') {
    return normalized;
  }

  throw new V2RuntimeConfigError(
    `Unsupported BROWSEGENT_V2_RUNTIME "${value}". Use "off", "mvr", or "agent".`,
  );
}

function readBoolean(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const value = readEnv(env, name);
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;

  throw new V2RuntimeConfigError(`Environment variable ${name} must be "true" or "false".`);
}

function readEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
