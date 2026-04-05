import { getActionCatalogEntry } from '../catalog';
import type { Action, ActionDefinition, ActionExecutionContext, ActionResult, AttemptMeta } from '../types';
import { coerceActionError, createRetryPolicy, requireTarget, successResult } from './helpers';

type CountElementsAction = Action & { target: string };

export function createCountElementsDefinition(): ActionDefinition<CountElementsAction, string> {
  const catalog = getActionCatalogEntry('count_elements');
  return {
    kind: 'count_elements',
    llmSpec: {
      externalName: 'count_elements',
      description: catalog.description,
      fields: catalog.fields,
    },
    validate(action) {
      return requireTarget(action);
    },
    async execute(action: CountElementsAction, ctx: ActionExecutionContext): Promise<string> {
      return ctx.adapter.countElements(action.target);
    },
    normalizeSuccess(raw: string, action: CountElementsAction, meta: AttemptMeta): ActionResult {
      return successResult(action, meta, raw);
    },
    normalizeFailure(error: unknown, _action: CountElementsAction, meta: AttemptMeta) {
      return coerceActionError(error, meta.runtime);
    },
    retryPolicy: createRetryPolicy(1, true),
  };
}
