import { getActionCatalogEntry } from '../catalog';
import { AdapterError } from '../browserAdapter';
import type { Action, ActionDefinition, ActionExecutionContext, ActionResult, AttemptMeta } from '../types';
import { coerceActionError, createRetryPolicy, requireTarget, successResult } from './helpers';

type GetAction = Action & { target: string };

export function createGetDefinition(): ActionDefinition<GetAction, string> {
  const catalog = getActionCatalogEntry('get');
  return {
    kind: 'get',
    llmSpec: {
      externalName: 'get',
      description: catalog.description,
      fields: catalog.fields,
    },
    validate(action) {
      return requireTarget(action);
    },
    async execute(action: GetAction, ctx: ActionExecutionContext): Promise<string> {
      const result = await ctx.adapter.readValue(action.target);
      if (!result.found) {
        throw new AdapterError('not_found', `Element not found: ${action.target}`, ctx.runtime);
      }
      return result.value;
    },
    normalizeSuccess(raw: string, action: GetAction, meta: AttemptMeta): ActionResult {
      return successResult(action, meta, raw);
    },
    normalizeFailure(error: unknown, _action: GetAction, meta: AttemptMeta) {
      return coerceActionError(error, meta.runtime);
    },
    retryPolicy: createRetryPolicy(2, true),
  };
}
