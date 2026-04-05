import { AdapterError } from '../browserAdapter';
import type {
  Action,
  ActionError,
  ActionErrorCode,
  ActionResult,
  AttemptMeta,
  RetryPolicy,
  ValidationResult,
} from '../types';

export const DEFAULT_RETRYABLE_CODES: ActionErrorCode[] = ['not_found', 'not_interactable', 'timeout'];

export function createActionError(
  code: ActionErrorCode,
  message: string,
  runtime: ActionError['runtime'],
  overrides?: Partial<Pick<ActionError, 'retryable' | 'shouldReplan'>>,
): ActionError {
  return {
    code,
    message,
    runtime,
    retryable: overrides?.retryable ?? DEFAULT_RETRYABLE_CODES.includes(code),
    shouldReplan: overrides?.shouldReplan ?? (code !== 'invalid_action' && code !== 'unsupported_runtime'),
  };
}

export function createValidationError(message: string): ValidationResult {
  return {
    ok: false,
    error: createActionError('invalid_action', message, 'none', { retryable: false, shouldReplan: true }),
  };
}

export function createRetryPolicy(maxDomAttempts = 2, allowPlaywrightFallback = true): RetryPolicy {
  return {
    maxDomAttempts,
    allowPlaywrightFallback,
    shouldRetry(error, attempt) {
      return error.retryable && DEFAULT_RETRYABLE_CODES.includes(error.code) && attempt < maxDomAttempts;
    },
  };
}

export function successResult(action: Action, meta: AttemptMeta, value?: string): ActionResult {
  return {
    success: true,
    kind: action.kind,
    value,
    metadata: {
      attempts: meta.attempt,
      durationMs: Date.now() - meta.startedAt,
      runtimePath: meta.runtimePath,
      finalRuntime: meta.runtime,
      usedFallback: meta.usedFallback,
      target: action.target,
      mutating: meta.mutating,
      effect: meta.effect,
    },
  };
}

export function failureResult(action: Action, meta: AttemptMeta, error: ActionError): ActionResult {
  return {
    success: false,
    kind: action.kind,
    error,
    metadata: {
      attempts: meta.attempt,
      durationMs: Date.now() - meta.startedAt,
      runtimePath: meta.runtimePath,
      finalRuntime: meta.runtime,
      usedFallback: meta.usedFallback,
      target: action.target,
      mutating: meta.mutating,
      effect: meta.effect,
    },
  };
}

export function coerceActionError(error: unknown, runtime: ActionError['runtime']): ActionError {
  if (error instanceof AdapterError) {
    return createActionError(error.code, error.message, error.runtime);
  }
  if (error instanceof Error) {
    return createActionError('execution_error', error.message, runtime);
  }
  return createActionError('execution_error', String(error), runtime);
}

export function requireTarget<T extends Action>(action: T, label = 'target'): ValidationResult<T & { target: string }> {
  if (!action.target) {
    return createValidationError(`${action.kind} requires ${label}`) as ValidationResult<T & { target: string }>;
  }
  return { ok: true, value: action as T & { target: string } };
}

export function requireInput<T extends Action>(action: T): ValidationResult<T & { input: string }> {
  if (action.input === undefined) {
    return createValidationError(`${action.kind} requires input`) as ValidationResult<T & { input: string }>;
  }
  return { ok: true, value: action as T & { input: string } };
}

export function requireOption<T extends Action>(action: T): ValidationResult<T & { option: string }> {
  if (action.option === undefined) {
    return createValidationError(`${action.kind} requires option`) as ValidationResult<T & { option: string }>;
  }
  return { ok: true, value: action as T & { option: string } };
}

export function requireDirection<T extends Action>(action: T): ValidationResult<T> {
  if (action.direction && action.direction !== 'down' && action.direction !== 'up') {
    return createValidationError(`${action.kind} direction must be "down" or "up"`) as ValidationResult<T>;
  }
  return { ok: true, value: action as T };
}

export function requireTimeoutNumber<T extends Action>(action: T): ValidationResult<T> {
  if (action.timeoutMs !== undefined && (!Number.isFinite(action.timeoutMs) || action.timeoutMs < 0)) {
    return createValidationError(`${action.kind} timeout must be a non-negative number`) as ValidationResult<T>;
  }
  return { ok: true, value: action as T };
}

export function requirePattern<T extends Action>(action: T): ValidationResult<T & { pattern: string }> {
  if (!action.pattern) {
    return createValidationError(`${action.kind} requires pattern`) as ValidationResult<T & { pattern: string }>;
  }
  return { ok: true, value: action as T & { pattern: string } };
}
