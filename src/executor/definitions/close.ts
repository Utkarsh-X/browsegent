import { getActionCatalogEntry } from '../catalog';
import type { Action, ActionDefinition, ActionExecutionContext, ActionResult, AttemptMeta } from '../types';
import { coerceActionError, createRetryPolicy, requireTarget, successResult } from './helpers';

type CloseAction = Action & { target: string };

export function createCloseDefinition(): ActionDefinition<CloseAction, void> {
  const catalog = getActionCatalogEntry('close');
  return {
    kind: 'close',
    llmSpec: {
      externalName: 'close',
      description: catalog.description,
      fields: catalog.fields,
    },
    validate(action) {
      return requireTarget(action);
    },
    async execute(action: CloseAction, ctx: ActionExecutionContext): Promise<void> {
      await ctx.adapter.recordClickCause?.(action.target);
      await ctx.adapter.click(action.target);
    },
    normalizeSuccess(_raw: void, action: CloseAction, meta: AttemptMeta): ActionResult {
      return successResult(action, meta);
    },
    normalizeFailure(error: unknown, _action: CloseAction, meta: AttemptMeta) {
      return coerceActionError(error, meta.runtime);
    },
    retryPolicy: createRetryPolicy(2, true),
  };
}
