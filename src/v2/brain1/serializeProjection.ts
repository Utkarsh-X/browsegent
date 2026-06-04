import type {
  OperationalProjection,
  ProjectionItem,
  SerializedProjection,
  SerializedProjectionItem,
  SerializedProjectionRef,
} from './projectionTypes';

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
    refs: serializeRefs(projection),
    interactions: serializeView(projection.interactions),
    readables: serializeView(projection.readables),
    navigation: serializeView(projection.navigation),
    regions: projection.regions,
    warnings: projection.warnings,
    stats: projection.stats,
  };
}

function serializeRefs(projection: OperationalProjection): Record<string, SerializedProjectionRef> {
  const refs: Record<string, SerializedProjectionRef> = {};
  for (const item of [...projection.interactions, ...projection.readables, ...projection.navigation]) {
    if (!refs[item.refId]) {
      refs[item.refId] = serializeRef(item);
    }
  }
  return refs;
}

function serializeView(items: ProjectionItem[]): SerializedProjectionItem[] {
  return items.map((item, index) => ({
    refId: item.refId,
    rank: index + 1,
  }));
}

function serializeRef(item: ProjectionItem): SerializedProjectionRef {
  const ref: SerializedProjectionRef = {
    refId: item.refId,
    kind: item.kind,
    role: item.role,
    name: item.name,
    text: textDistinctFromName(item.text, item.name) ? item.text : undefined,
    visibility: item.visibility,
    actionability: item.actionability,
    state: item.state,
    confidence: item.continuityConfidence,
    score: item.score,
    regionId: item.regionId,
  };

  if (item.selectOptions?.length) {
    ref.selectOptions = item.selectOptions.slice(0, 20);
  }

  return ref;
}

function textDistinctFromName(text: string | undefined, name: string | undefined): boolean {
  if (!text?.trim()) {
    return false;
  }

  if (!name?.trim()) {
    return true;
  }

  return normalizeText(text) !== normalizeText(name);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}
