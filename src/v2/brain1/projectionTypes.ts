import type {
  ActionabilityState,
  EditableKind,
  RefState,
  RuntimeWarning,
  V2RefCapabilities,
  VisibilityState,
} from '../runtime/types';

export type ProjectionItemKind = 'link' | 'button' | 'input' | 'select' | 'editable' | 'generic';
export type ProjectionRegionKind = 'repeated_list' | 'form' | 'navigation' | 'content';

export interface ProjectionItem {
  refId: string;
  kind: ProjectionItemKind;
  role?: string;
  name?: string;
  text?: string;
  tagName?: string;
  inputType?: string;
  editableKind?: EditableKind;
  capabilities?: V2RefCapabilities;
  visibility: VisibilityState;
  actionability: ActionabilityState;
  state: RefState;
  continuityConfidence: number;
  score: number;
  regionId?: string;
  selectOptions?: string[];
  graphPresent?: boolean;
  graphConfidence?: number;
  recentlyAppeared?: boolean;
  recentlyChanged?: boolean;
  recentlyWeakened?: boolean;
}

export interface ProjectionRegion {
  regionId: string;
  kind: ProjectionRegionKind;
  label: string;
  refIds: string[];
  score: number;
}

export interface ProjectionFocus {
  refId: string;
  reason: 'highest_operational_score';
}

export interface OperationalProjection {
  projectionId: string;
  observationId: string;
  generationId: number;
  url: string;
  title: string;
  interactions: ProjectionItem[];
  readables: ProjectionItem[];
  navigation: ProjectionItem[];
  regions: ProjectionRegion[];
  focus?: ProjectionFocus;
  warnings: RuntimeWarning[];
  stats: {
    interactionCount: number;
    readableCount: number;
    navigationCount: number;
    regionCount: number;
  };
}

export interface SerializedProjection {
  projectionId: string;
  observationId: string;
  generationId: number;
  page: {
    url: string;
    title: string;
  };
  focus?: ProjectionFocus;
  refs: Record<string, SerializedProjectionRef>;
  interactions: SerializedProjectionItem[];
  readables: SerializedProjectionItem[];
  navigation: SerializedProjectionItem[];
  regions: ProjectionRegion[];
  warnings: RuntimeWarning[];
  stats: OperationalProjection['stats'];
}

export interface SerializedProjectionRef {
  refId: string;
  kind: ProjectionItemKind;
  role?: string;
  name?: string;
  text?: string;
  visibility: VisibilityState;
  actionability: ActionabilityState;
  state: RefState;
  confidence: number;
  score: number;
  regionId?: string;
  selectOptions?: string[];
}

export interface SerializedProjectionItem {
  refId: string;
  rank: number;
}
