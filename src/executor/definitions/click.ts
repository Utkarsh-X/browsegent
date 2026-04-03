import { getActionCatalogEntry } from '../catalog';
import type { Action, ActionDefinition, ActionExecutionContext, ActionResult, AttemptMeta } from '../types';
import { coerceActionError, createRetryPolicy, requireTarget, successResult } from './helpers';

type ClickAction = Action & { target: string };

export function createClickDefinition(): ActionDefinition<ClickAction, void> {
  const catalog = getActionCatalogEntry('click');
  return {
    kind: 'click',
    llmSpec: {
      externalName: 'click',
      description: catalog.description,
      fields: catalog.fields,
    },
    validate(action) {
      return requireTarget(action);
    },
    async execute(action: ClickAction, ctx: ActionExecutionContext): Promise<void> {
      await ctx.adapter.recordClickCause?.(action.target);
      await ctx.adapter.click(action.target);
    },
    normalizeSuccess(_raw: void, action: ClickAction, meta: AttemptMeta): ActionResult {
      return successResult(action, meta);
    },
    normalizeFailure(error: unknown, _action: ClickAction, meta: AttemptMeta) {
      return coerceActionError(error, meta.runtime);
    },
    retryPolicy: createRetryPolicy(2, true),
  };
}
