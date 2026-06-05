import type { OperationalProjection, ProjectionItem } from '../brain1/projectionTypes';

export interface FinalizationEvidenceInput {
  goal: string;
  projection: OperationalProjection;
  lastSuccessfulEvidenceValue?: string;
  maxReadableItems?: number;
  maxTextLength?: number;
}

export function buildFinalizationEvidence(input: FinalizationEvidenceInput): string {
  const maxReadableItems = input.maxReadableItems ?? 12;
  const maxTextLength = input.maxTextLength ?? 180;
  const sections: string[] = [];

  if (input.lastSuccessfulEvidenceValue?.trim()) {
    sections.push(`Last successful evidence: ${compactText(input.lastSuccessfulEvidenceValue, maxTextLength)}`);
  }

  const readableItems = input.projection.readables
    .filter(item => item.visibility === 'visible')
    .filter(item => Boolean(item.name?.trim() || item.text?.trim()))
    .sort((left, right) => scoreReadable(right, input.goal) - scoreReadable(left, input.goal))
    .slice(0, maxReadableItems);

  if (readableItems.length > 0) {
    sections.push([
      'Readable evidence:',
      ...readableItems.map(item => `- ${item.refId}: ${compactText([item.name, item.text].filter(Boolean).join(' '), maxTextLength)}`),
    ].join('\n'));
  }

  return sections.join('\n\n');
}

function scoreReadable(item: ProjectionItem, goal: string): number {
  const text = `${item.name ?? ''} ${item.text ?? ''}`.toLowerCase();
  let score = item.score;
  for (const token of goal.toLowerCase().split(/[^a-z0-9]+/).filter(part => part.length >= 3)) {
    if (text.includes(token)) score += 25;
  }
  if (item.visibility === 'visible') score += 20;
  return score;
}

function compactText(value: string, maxLength: number): string {
  const compacted = value.replace(/\s+/g, ' ').trim();
  return compacted.length > maxLength ? `${compacted.slice(0, maxLength - 3)}...` : compacted;
}
