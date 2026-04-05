import type { ActionFieldSpec, ActionKind } from './types';

export interface ActionCatalogEntry {
  kind: ActionKind;
  description: string;
  mutating: boolean;
  fields: ActionFieldSpec[];
}

const ACTION_CATALOG_LIST: ActionCatalogEntry[] = [
  {
    kind: 'click',
    description: 'Click an element by selector.',
    mutating: true,
    fields: [{ name: 'sel', required: true, type: 'string' }],
  },
  {
    kind: 'type',
    description: 'Type text into an input by selector.',
    mutating: true,
    fields: [
      { name: 'sel', required: true, type: 'string' },
      { name: 'text', required: true, type: 'string' },
    ],
  },
  {
    kind: 'scroll',
    description: 'Scroll the page up or down.',
    mutating: true,
    fields: [{ name: 'direction', required: false, type: 'enum', enumValues: ['down', 'up'] }],
  },
  {
    kind: 'wait',
    description: 'Wait for a duration or until page text matches a pattern.',
    mutating: false,
    fields: [
      { name: 'pattern', required: false, type: 'string' },
      { name: 'timeout', required: false, type: 'number' },
    ],
  },
  {
    kind: 'get',
    description: 'Read text or value from an element by selector.',
    mutating: false,
    fields: [{ name: 'sel', required: true, type: 'string' }],
  },
  {
    kind: 'search_page',
    description: 'Search page text for a literal pattern. Optionally limit search to a selector scope.',
    mutating: false,
    fields: [
      { name: 'pattern', required: true, type: 'string' },
      { name: 'sel', required: false, type: 'string' },
    ],
  },
  {
    kind: 'find_elements',
    description: 'Inspect elements matching a selector without changing the page.',
    mutating: false,
    fields: [{ name: 'sel', required: true, type: 'string' }],
  },
  {
    kind: 'count_elements',
    description: 'Count how many elements match a selector without changing the page.',
    mutating: false,
    fields: [{ name: 'sel', required: true, type: 'string' }],
  },
  {
    kind: 'inspect_region',
    description: 'Inspect a page region by selector and summarize notable nodes in it.',
    mutating: false,
    fields: [{ name: 'sel', required: true, type: 'string' }],
  },
  {
    kind: 'close',
    description: 'Close a modal or dismiss UI by clicking a selector.',
    mutating: true,
    fields: [{ name: 'sel', required: true, type: 'string' }],
  },
  {
    kind: 'select',
    description: 'Select an option in a dropdown by selector.',
    mutating: true,
    fields: [
      { name: 'sel', required: true, type: 'string' },
      { name: 'value', required: true, type: 'string' },
    ],
  },
];

export const ACTION_CATALOG: Record<ActionKind, ActionCatalogEntry> = ACTION_CATALOG_LIST.reduce(
  (acc, entry) => {
    acc[entry.kind] = entry;
    return acc;
  },
  {} as Record<ActionKind, ActionCatalogEntry>,
);

export const ACTION_KINDS = ACTION_CATALOG_LIST.map(entry => entry.kind);

export function getActionCatalogEntry(kind: ActionKind): ActionCatalogEntry {
  return ACTION_CATALOG[kind];
}

export function getValidActionKinds(): ActionKind[] {
  return [...ACTION_KINDS];
}

export function getRequiredExternalFields(kind: ActionKind): string[] {
  return getActionCatalogEntry(kind).fields.filter(field => field.required).map(field => field.name);
}

export function getActionMutating(kind: ActionKind): boolean {
  return getActionCatalogEntry(kind).mutating;
}

export function buildToolSignatureBlock(): string {
  return ACTION_CATALOG_LIST
    .map(entry => {
      const pieces = [`"tool":"${entry.kind}"`];
      for (const field of entry.fields) {
        let value = '<value>';
        if (field.name === 'sel') value = '<selector>';
        if (field.name === 'value') value = '<option>';
        if (field.name === 'direction') value = 'down';
        if (field.name === 'pattern') value = '<regex>';
        if (field.name === 'timeout') value = '<ms>';
        const rendered = field.type === 'number' ? value : `"${value}"`;
        pieces.push(`"${field.name}":${rendered}`);
      }
      return `{${pieces.join(',')}}`;
    })
    .join('\n');
}

export function buildPlanStepJsonSchema(): Record<string, unknown> {
  const fieldMap = new Map<string, Record<string, unknown>>();
  fieldMap.set('tool', { type: 'string', enum: ACTION_KINDS });

  for (const entry of ACTION_CATALOG_LIST) {
    for (const field of entry.fields) {
      if (fieldMap.has(field.name)) continue;
      if (field.type === 'enum') {
        fieldMap.set(field.name, { type: 'string', enum: field.enumValues ?? [] });
      } else if (field.type === 'number') {
        fieldMap.set(field.name, { type: 'number' });
      } else {
        fieldMap.set(field.name, { type: 'string' });
      }
    }
  }

  return {
    type: 'object',
    properties: Object.fromEntries(fieldMap.entries()),
    required: ['tool'],
  };
}

export function buildGeminiResponseSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      plan: {
        type: 'array',
        items: buildPlanStepJsonSchema(),
      },
      done: { type: 'boolean' },
      val: { type: 'string' },
      escalate: { type: 'string', enum: ['user_needed', 'captcha', 'dead_end'] },
      reason: { type: 'string' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    },
  };
}
