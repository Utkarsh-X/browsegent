import { getActionCatalogEntry } from '../catalog';
import type { Action, ActionDefinition, ActionExecutionContext, ActionResult, AttemptMeta } from '../types';
import { coerceActionError, createRetryPolicy, requireTimeoutNumber, successResult } from './helpers';

type WaitAction = Action & { timeoutMs: number };

export function createWaitDefinition(): ActionDefinition<WaitAction, boolean | void> {
  const catalog = getActionCatalogEntry('wait');
  return {
    kind: 'wait',
    llmSpec: {
      externalName: 'wait',
      description: catalog.description,
      fields: catalog.fields,
    },
    validate(action) {
      const timeoutCheck = requireTimeoutNumber(action);
      if (!timeoutCheck.ok) return timeoutCheck;
      return {
        ok: true,
        value: { ...action, timeoutMs: action.timeoutMs ?? 2000 },
      };
    },
    async execute(action: WaitAction, ctx: ActionExecutionContext): Promise<boolean | void> {
      if (action.pattern) {
        const matched = await ctx.adapter.waitForPattern(action.pattern, action.timeoutMs);
        if (!matched) {
          throw new Error(`Pattern not observed before timeout: ${action.pattern}`);
        }
        return true;
      }
      await ctx.adapter.sleep(action.timeoutMs);
    },
    normalizeSuccess(_raw: boolean | void, action: WaitAction, meta: AttemptMeta): ActionResult {
      return successResult(action, meta);
    },
    normalizeFailure(error: unknown, _action: WaitAction, meta: AttemptMeta) {
      const actionError = coerceActionError(error, meta.runtime);
      if (actionError.code === 'execution_error') {
        return { ...actionError, code: 'timeout', retryable: true };
      }
      return actionError;
    },
    retryPolicy: createRetryPolicy(1, true),
  };
}
