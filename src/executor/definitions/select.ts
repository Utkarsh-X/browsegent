import { getActionCatalogEntry } from '../catalog';
import { AdapterError } from '../browserAdapter';
import type { Action, ActionDefinition, ActionExecutionContext, ActionResult, AttemptMeta } from '../types';
import { coerceActionError, createRetryPolicy, requireOption, requireTarget, successResult } from './helpers';

type SelectAction = Action & { target: string; option: string };

export function createSelectDefinition(): ActionDefinition<SelectAction, string> {
  const catalog = getActionCatalogEntry('select');
  return {
    kind: 'select',
    llmSpec: {
      externalName: 'select',
      description: catalog.description,
      fields: catalog.fields,
    },
    validate(action) {
      const targetCheck = requireTarget(action);
      if (!targetCheck.ok) return targetCheck;
      return requireOption(targetCheck.value as SelectAction);
    },
    async execute(action: SelectAction, ctx: ActionExecutionContext): Promise<string> {
      await ctx.adapter.selectOption(action.target, action.option);
      const result = await ctx.adapter.readValue(action.target);
      if (!result.found) {
        throw new AdapterError('not_found', `Element not found after select: ${action.target}`, ctx.runtime);
      }
      if (result.value !== action.option) {
        throw new AdapterError('not_interactable', `Selected value mismatch for ${action.target}`, ctx.runtime);
      }
      return result.value;
    },
    normalizeSuccess(raw: string, action: SelectAction, meta: AttemptMeta): ActionResult {
      return successResult(action, meta, raw);
    },
    normalizeFailure(error: unknown, _action: SelectAction, meta: AttemptMeta) {
      return coerceActionError(error, meta.runtime);
    },
    retryPolicy: createRetryPolicy(2, true),
  };
}
