import type { OperationalProjection, ProjectionItem, SerializedProjection, SerializedProjectionItem } from './projectionTypes';

export function serializeProjection(projection: OperationalProjection): SerializedProjection {
  return {
    projectionId: projection.projectionId,
    observationId: projection.observationId,
    generationId: projection.generationId,
    page: {
      url: projection.url,
      title: projection.title,
    },
    focus: projection.focus,
    interactions: projection.interactions.map(serializeItem),
    readables: projection.readables.map(serializeItem),
    navigation: projection.navigation.map(serializeItem),
    regions: projection.regions,
    warnings: projection.warnings,
    stats: projection.stats,
  };
}

function serializeItem(item: ProjectionItem): SerializedProjectionItem {
  return {
    refId: item.refId,
    kind: item.kind,
    role: item.role,
    name: item.name,
    text: item.text,
    visibility: item.visibility,
    actionability: item.actionability,
    state: item.state,
    confidence: item.continuityConfidence,
    score: item.score,
    regionId: item.regionId,
  };
}
