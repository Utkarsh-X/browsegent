import type { ActionDefinition, ActionKind } from './types';
import { createClickDefinition } from './definitions/click';
import { createCloseDefinition } from './definitions/close';
import { createCountElementsDefinition } from './definitions/countElements';
import { createFindElementsDefinition } from './definitions/findElements';
import { createGetDefinition } from './definitions/get';
import { createInspectRegionDefinition } from './definitions/inspectRegion';
import { createSearchPageDefinition } from './definitions/searchPage';
import { createScrollDefinition } from './definitions/scroll';
import { createSelectDefinition } from './definitions/select';
import { createTypeDefinition } from './definitions/type';
import { createWaitDefinition } from './definitions/wait';

export class ActionRegistry {
  private readonly definitions = new Map<ActionKind, ActionDefinition>();

  register(definition: ActionDefinition): void {
    this.definitions.set(definition.kind, definition);
  }

  resolve(kind: ActionKind): ActionDefinition | undefined {
    return this.definitions.get(kind);
  }

  all(): ActionDefinition[] {
    return [...this.definitions.values()];
  }
}

export function createDefaultRegistry(): ActionRegistry {
  const registry = new ActionRegistry();
  [
    createClickDefinition(),
    createTypeDefinition(),
    createScrollDefinition(),
    createWaitDefinition(),
    createGetDefinition(),
    createSearchPageDefinition(),
    createFindElementsDefinition(),
    createCountElementsDefinition(),
    createInspectRegionDefinition(),
    createCloseDefinition(),
    createSelectDefinition(),
  ].forEach(definition => registry.register(definition));
  return registry;
}
