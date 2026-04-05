import { getActionCatalogEntry } from '../catalog';
import type { Action, ActionDefinition, ActionExecutionContext, ActionResult, AttemptMeta } from '../types';
import { coerceActionError, createRetryPolicy, requireTarget, successResult } from './helpers';

type InspectRegionAction = Action & { target: string };

export function createInspectRegionDefinition(): ActionDefinition<InspectRegionAction, string> {
  const catalog = getActionCatalogEntry('inspect_region');
  return {
    kind: 'inspect_region',
    llmSpec: {
      externalName: 'inspect_region',
      description: catalog.description,
      fields: catalog.fields,
    },
    validate(action) {
      return requireTarget(action);
    },
    async execute(action: InspectRegionAction, ctx: ActionExecutionContext): Promise<string> {
      return ctx.adapter.inspectRegion(action.target);
    },
    normalizeSuccess(raw: string, action: InspectRegionAction, meta: AttemptMeta): ActionResult {
      return successResult(action, meta, raw);
    },
    normalizeFailure(error: unknown, _action: InspectRegionAction, meta: AttemptMeta) {
      return coerceActionError(error, meta.runtime);
    },
    retryPolicy: createRetryPolicy(1, true),
  };
}
