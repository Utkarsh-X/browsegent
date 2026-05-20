import type { BrowserObservation, V2Ref } from '../runtime/types';
import type { ContinuityGraphSnapshot } from '../graph/types';
import type { OperationalProjection, ProjectionItem, ProjectionRegion } from './projectionTypes';
import { sortProjectionItems, toProjectionItem } from './rankOperationalItems';

export class ProjectionService {
  project(observation: BrowserObservation, _graphSnapshot?: ContinuityGraphSnapshot): OperationalProjection {
    const items = observation.refs.map(toProjectionItem);
    const regions = buildRepeatedRegions(observation.refs);
    const regionByRef = new Map<string, string>();
    for (const region of regions) {
      for (const refId of region.refIds) {
        regionByRef.set(refId, region.regionId);
      }
    }

    const regionedItems = items.map(item => ({
      ...item,
      regionId: regionByRef.get(item.refId),
    }));
    const interactions = sortProjectionItems(regionedItems);
    const readables = sortProjectionItems(regionedItems.filter(hasReadableText));
    const navigation = sortProjectionItems(regionedItems.filter(item => item.kind === 'link'));
    const focus = interactions[0]
      ? { refId: interactions[0].refId, reason: 'highest_operational_score' as const }
      : undefined;

    return {
      projectionId: `projection_${observation.observationId}`,
      observationId: observation.observationId,
      generationId: observation.generationId,
      url: observation.url,
      title: observation.title,
      interactions,
      readables,
      navigation,
      regions,
      focus,
      warnings: observation.warnings,
      stats: {
        interactionCount: interactions.length,
        readableCount: readables.length,
        navigationCount: navigation.length,
        regionCount: regions.length,
      },
    };
  }
}

function hasReadableText(item: ProjectionItem): boolean {
  return Boolean(item.name?.trim() || item.text?.trim());
}

function buildRepeatedRegions(refs: V2Ref[]): ProjectionRegion[] {
  const groups = new Map<string, V2Ref[]>();
  for (const ref of refs) {
    const key = repeatedKey(ref);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(ref);
    groups.set(key, group);
  }

  const regions: ProjectionRegion[] = [];
  let index = 1;
  for (const [key, group] of groups) {
    if (group.length < 3) continue;
    const role = group[0].role ?? 'generic';
    const score = Math.round(group.reduce((total, ref) => total + ref.continuityConfidence, 0) / group.length * 100);
    regions.push({
      regionId: `region_repeated_${index++}`,
      kind: 'repeated_list',
      label: `Repeated ${role} controls`,
      refIds: group.map(ref => ref.refId),
      score,
    });
  }

  return regions.sort((left, right) => {
    if (right.refIds.length !== left.refIds.length) return right.refIds.length - left.refIds.length;
    return left.regionId.localeCompare(right.regionId);
  });
}

function repeatedKey(ref: V2Ref): string | undefined {
  const name = ref.name?.trim().toLowerCase();
  const role = ref.role?.trim().toLowerCase();
  if (!name || !role) {
    return undefined;
  }

  return `${role}|${name}`;
}
