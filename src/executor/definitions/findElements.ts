import { getActionCatalogEntry } from '../catalog';
import type { Action, ActionDefinition, ActionExecutionContext, ActionResult, AttemptMeta } from '../types';
import { coerceActionError, createRetryPolicy, requireTarget, successResult } from './helpers';

type FindElementsAction = Action & { target: string };

export function createFindElementsDefinition(): ActionDefinition<FindElementsAction, string> {
  const catalog = getActionCatalogEntry('find_elements');
  return {
    kind: 'find_elements',
    llmSpec: {
      externalName: 'find_elements',
      description: catalog.description,
      fields: catalog.fields,
    },
    validate(action) {
      return requireTarget(action);
    },
    async execute(action: FindElementsAction, ctx: ActionExecutionContext): Promise<string> {
      return ctx.adapter.findElements(action.target);
    },
    normalizeSuccess(raw: string, action: FindElementsAction, meta: AttemptMeta): ActionResult {
      return successResult(action, meta, raw);
    },
    normalizeFailure(error: unknown, _action: FindElementsAction, meta: AttemptMeta) {
      return coerceActionError(error, meta.runtime);
    },
    retryPolicy: createRetryPolicy(1, true),
  };
}
