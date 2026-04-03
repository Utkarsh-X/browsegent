import { getActionCatalogEntry } from '../catalog';
import { AdapterError } from '../browserAdapter';
import type { Action, ActionDefinition, ActionExecutionContext, ActionResult, AttemptMeta } from '../types';
import { coerceActionError, createRetryPolicy, requireInput, requireTarget, successResult } from './helpers';

type TypeAction = Action & { target: string; input: string };

export function createTypeDefinition(): ActionDefinition<TypeAction, string> {
  const catalog = getActionCatalogEntry('type');
  return {
    kind: 'type',
    llmSpec: {
      externalName: 'type',
      description: catalog.description,
      fields: catalog.fields,
    },
    validate(action) {
      const targetCheck = requireTarget(action);
      if (!targetCheck.ok) return targetCheck;
      return requireInput(targetCheck.value as TypeAction);
    },
    async execute(action: TypeAction, ctx: ActionExecutionContext): Promise<string> {
      await ctx.adapter.type(action.target, action.input, { clear: true });
      const result = await ctx.adapter.readValue(action.target);
      if (!result.found) {
        throw new AdapterError('not_found', `Element not found after type: ${action.target}`, ctx.runtime);
      }
      if (result.value !== action.input) {
        throw new AdapterError('not_interactable', `Typed value mismatch for ${action.target}`, ctx.runtime);
      }
      return result.value;
    },
    normalizeSuccess(raw: string, action: TypeAction, meta: AttemptMeta): ActionResult {
      return successResult(action, meta, raw);
    },
    normalizeFailure(error: unknown, _action: TypeAction, meta: AttemptMeta) {
      return coerceActionError(error, meta.runtime);
    },
    retryPolicy: createRetryPolicy(2, true),
  };
}
