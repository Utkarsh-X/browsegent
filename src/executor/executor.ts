import { logger } from '../logger';
import type { BrowserAdapter } from './browserAdapter';
import { getActionMutating } from './catalog';
import { createActionError, failureResult } from './definitions/helpers';
import { deriveActionEffect } from './effects';
import { ActionRegistry } from './registry';
import type { Action, ActionDefinition, ActionResult, AttemptMeta, ExecutorHookMeta, ExecutorHooks } from './types';

const RETRY_DELAYS_MS = [250, 500];

export interface ExecutorOptions {
  executionId: string;
  registry: ActionRegistry;
  adapters: {
    dom: BrowserAdapter;
    playwright: BrowserAdapter;
  };
  hooks?: ExecutorHooks;
}

export class Executor {
  private actionSequence = 0;
  private readonly hooks: Required<ExecutorHooks>;

  constructor(private readonly options: ExecutorOptions) {
    this.hooks = {
      beforeExecute: options.hooks?.beforeExecute ?? [],
      afterExecute: options.hooks?.afterExecute ?? [],
      onFailure: options.hooks?.onFailure ?? [],
    };
  }

  async execute(action: Action): Promise<ActionResult> {
    const actionId = `${this.options.executionId}:${++this.actionSequence}`;
    const startedAt = Date.now();
    const hookMeta: ExecutorHookMeta = {
      executionId: this.options.executionId,
      actionId,
      startedAt,
    };

    const definition = this.options.registry.resolve(action.kind);
    if (!definition) {
      const result = failureResult(
        action,
        this.createAttemptMeta(action, 'none', 0, [], false, startedAt, actionId),
        createActionError('invalid_action', `Unknown action kind: ${action.kind}`, 'none', { retryable: false }),
      );
      await this.runAfterHooks(result, hookMeta);
      return result;
    }

    const validation = definition.validate(action);
    if (!validation.ok) {
      const result = failureResult(
        action,
        this.createAttemptMeta(action, 'none', 0, [], false, startedAt, actionId),
        validation.error,
      );
      await this.runAfterHooks(result, hookMeta);
      return result;
    }

    await this.runBeforeHooks(validation.value, hookMeta);

    const runtimePath: Array<'dom' | 'playwright'> = [];
    let attemptCount = 0;
    let lastFailure = null as ActionResult | null;

    const domAdapter = this.options.adapters.dom;
    if (await domAdapter.isAvailable()) {
      runtimePath.push('dom');
      for (let attempt = 1; attempt <= definition.retryPolicy.maxDomAttempts; attempt++) {
        attemptCount++;
        const result = await this.tryRuntime(definition, validation.value, domAdapter, {
          actionId,
          attempt: attemptCount,
          runtimePath,
          startedAt,
          usedFallback: false,
        });
        if (result.success) {
          await this.runAfterHooks(result, hookMeta);
          return result;
        }
        lastFailure = result;
        if (!result.error || !definition.retryPolicy.shouldRetry(result.error, attempt)) {
          break;
        }
        const retryDelay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)] ?? RETRY_DELAYS_MS[0]!;
        logger.info('executor', 'Retrying DOM action', {
          executionId: this.options.executionId,
          actionId,
          kind: action.kind,
          attempt,
          retryDelay,
          errorCode: result.error.code,
        });
        await domAdapter.sleep(retryDelay);
      }
    }

    const shouldFallback =
      definition.retryPolicy.allowPlaywrightFallback &&
      (!lastFailure?.error || lastFailure.error.retryable || lastFailure.error.code === 'unsupported_runtime');

    const playwrightAdapter = this.options.adapters.playwright;
    if (shouldFallback && await playwrightAdapter.isAvailable()) {
      runtimePath.push('playwright');
      attemptCount++;
      const result = await this.tryRuntime(definition, validation.value, playwrightAdapter, {
        actionId,
        attempt: attemptCount,
        runtimePath,
        startedAt,
        usedFallback: runtimePath.length > 1,
      });
      await this.runAfterHooks(result, hookMeta);
      return result;
    }

    const result = lastFailure ?? failureResult(
      validation.value,
      this.createAttemptMeta(validation.value, 'none', attemptCount, runtimePath, runtimePath.length > 1, startedAt, actionId),
      createActionError('unsupported_runtime', `No runtime available for ${action.kind}`, 'none'),
    );
    await this.runAfterHooks(result, hookMeta);
    return result;
  }

  private async tryRuntime(
    definition: ActionDefinition,
    action: Action,
    adapter: BrowserAdapter,
    metaInput: {
      actionId: string;
      attempt: number;
      runtimePath: Array<'dom' | 'playwright'>;
      startedAt: number;
      usedFallback: boolean;
    },
  ): Promise<ActionResult> {
    const meta = this.createAttemptMeta(
      action,
      adapter.runtime,
      metaInput.attempt,
      metaInput.runtimePath,
      metaInput.usedFallback,
      metaInput.startedAt,
      metaInput.actionId,
    );

    logger.info('executor', 'Executing action', {
      executionId: this.options.executionId,
      actionId: metaInput.actionId,
      kind: action.kind,
      runtime: adapter.runtime,
      attempt: metaInput.attempt,
      target: action.target,
    });

    try {
      const beforeState = await this.captureState(adapter, action.target);
      const raw = await definition.execute(action, {
        adapter,
        executionId: this.options.executionId,
        actionId: metaInput.actionId,
        runtime: adapter.runtime,
        attempt: metaInput.attempt,
      });
      const afterState = await this.captureState(adapter, action.target);
      meta.effect = deriveActionEffect(action, beforeState, afterState, typeof raw === 'string' ? raw : undefined);
      const result = definition.normalizeSuccess(raw, action, meta);
      logger.info('executor', 'Action succeeded', {
        executionId: this.options.executionId,
        actionId: metaInput.actionId,
        kind: action.kind,
        runtime: adapter.runtime,
        attempt: metaInput.attempt,
        usedFallback: metaInput.usedFallback,
        effect: result.metadata.effect?.primarySignal,
      });
      return result;
    } catch (error) {
      const actionError = definition.normalizeFailure(error, action, meta);
      logger.warn('executor', 'Action failed', {
        executionId: this.options.executionId,
        actionId: metaInput.actionId,
        kind: action.kind,
        runtime: adapter.runtime,
        attempt: metaInput.attempt,
        errorCode: actionError.code,
        message: actionError.message,
      });
      return failureResult(action, meta, actionError);
    }
  }

  private async captureState(adapter: BrowserAdapter, target?: string) {
    try {
      return await adapter.captureState(target);
    } catch (error) {
      logger.warn('executor', 'Runtime state capture failed', {
        executionId: this.options.executionId,
        runtime: adapter.runtime,
        target,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private createAttemptMeta(
    action: Action,
    runtime: AttemptMeta['runtime'],
    attempt: number,
    runtimePath: Array<'dom' | 'playwright'>,
    usedFallback: boolean,
    startedAt: number,
    actionId: string,
  ): AttemptMeta {
    return {
      executionId: this.options.executionId,
      actionId,
      runtime,
      attempt,
      startedAt,
      runtimePath,
      usedFallback,
      mutating: getActionMutating(action.kind),
    };
  }

  private async runBeforeHooks(action: Action, meta: ExecutorHookMeta): Promise<void> {
    for (const hook of this.hooks.beforeExecute) {
      await hook(action, meta);
    }
  }

  private async runAfterHooks(result: ActionResult, meta: ExecutorHookMeta): Promise<void> {
    for (const hook of this.hooks.afterExecute) {
      await hook(result, meta);
    }
    if (!result.success) {
      for (const hook of this.hooks.onFailure) {
        await hook(result, meta);
      }
    }
  }
}
