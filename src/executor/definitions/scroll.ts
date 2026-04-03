import { getActionCatalogEntry } from '../catalog';
import type { Action, ActionDefinition, ActionExecutionContext, ActionResult, AttemptMeta } from '../types';
import { createRetryPolicy, createValidationError, successResult, coerceActionError } from './helpers';

type ScrollAction = Action & { direction: 'down' | 'up' };

export function createScrollDefinition(): ActionDefinition<ScrollAction, void> {
  const catalog = getActionCatalogEntry('scroll');
  return {
    kind: 'scroll',
    llmSpec: {
      externalName: 'scroll',
      description: catalog.description,
      fields: catalog.fields,
    },
    validate(action): import('../types').ValidationResult<ScrollAction> {
      const direction = action.direction ?? 'down';
      if (direction !== 'down' && direction !== 'up') {
        return createValidationError('scroll direction must be "down" or "up"') as import('../types').ValidationResult<ScrollAction>;
      }
      return { ok: true, value: { ...action, direction } as ScrollAction };
    },
    async execute(action: ScrollAction, ctx: ActionExecutionContext): Promise<void> {
      await ctx.adapter.scroll(action.direction);
    },
    normalizeSuccess(_raw: void, action: ScrollAction, meta: AttemptMeta): ActionResult {
      return successResult(action, meta);
    },
    normalizeFailure(error: unknown, _action: ScrollAction, meta: AttemptMeta) {
      return coerceActionError(error, meta.runtime);
    },
    retryPolicy: createRetryPolicy(1, true),
  };
}
