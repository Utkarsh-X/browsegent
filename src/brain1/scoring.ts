import type { FilteredNode } from './types';

export function getBrain1NodePriority(node: FilteredNode): number {
  const meta = node.meta;
  const visibilityBonus = meta?.visibility === 'visible'
    ? 15
    : meta?.visibility === 'offscreen'
      ? 4
      : -20;
  const typeBonus = node.type === 'input'
    ? 18
    : node.type === 'trigger'
      ? 14
      : node.type === 'table_cell'
        ? 8
        : 0;
  const confidenceBonus = meta?.confidence === 'high'
    ? 12
    : meta?.confidence === 'medium'
      ? 4
      : -8;

  return (meta?.goalScore ?? 0) * 5
    + (meta?.interactionScore ?? 0) * 2
    + (meta?.actionabilityScore ?? 0) * 2
    + (meta?.selectorScore ?? 0) * 1.5
    + visibilityBonus
    + confidenceBonus
    + typeBonus;
}
