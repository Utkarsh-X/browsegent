import { getActionCatalogEntry } from '../catalog';
import type { Action, ActionDefinition, ActionExecutionContext, ActionResult, AttemptMeta } from '../types';
import { coerceActionError, createRetryPolicy, requirePattern, successResult } from './helpers';

type SearchPageAction = Action & { pattern: string };

export function createSearchPageDefinition(): ActionDefinition<SearchPageAction, string> {
  const catalog = getActionCatalogEntry('search_page');
  return {
    kind: 'search_page',
    llmSpec: {
      externalName: 'search_page',
      description: catalog.description,
      fields: catalog.fields,
    },
    validate(action) {
      return requirePattern(action);
    },
    async execute(action: SearchPageAction, ctx: ActionExecutionContext): Promise<string> {
      return ctx.adapter.searchPage(action.pattern, action.target);
    },
    normalizeSuccess(raw: string, action: SearchPageAction, meta: AttemptMeta): ActionResult {
      return successResult(action, meta, raw);
    },
    normalizeFailure(error: unknown, _action: SearchPageAction, meta: AttemptMeta) {
      return coerceActionError(error, meta.runtime);
    },
    retryPolicy: createRetryPolicy(1, true),
  };
}
