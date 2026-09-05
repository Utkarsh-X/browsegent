import type {
  ActionabilityState,
  EditableKind,
  Rect,
  RefState,
  RuntimeWarning,
  V2RefCapabilities,
  VisibilityState,
} from '../runtime/types';

export type ProjectionItemKind = 'link' | 'button' | 'input' | 'select' | 'editable' | 'generic';
export type ProjectionRegionKind = 'repeated_list' | 'form' | 'navigation' | 'content';

export interface ProjectionItem {
  refId: string;
  /** Internal continuity identity; never serialized to the planner. */
  targetId?: string;
  kind: ProjectionItemKind;
  role?: string;
  name?: string;
  text?: string;
  tagName?: string;
  inputType?: string;
  inForm?: boolean;
  value?: string;
  placeholder?: string;
  ariaAutocomplete?: string;
  ariaHasPopup?: string;
  editableKind?: EditableKind;
  capabilities?: V2RefCapabilities;
  /** Viewport geometry from the substrate capture; internal, never serialized to the planner. */
  box?: Rect;
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

export interface ProjectionProse {
  proseId: string;
  anchorRefIds: string[];
  text: string;
}

export interface OperationalProjection {
  projectionId: string;
  observationId: string;
  generationId: number;
  url: string;
  title: string;
  /** Page-declared language; internal, never serialized to the planner verbatim. */
  lang?: string;
  interactions: ProjectionItem[];
  readables: ProjectionItem[];
  navigation: ProjectionItem[];
  regions: ProjectionRegion[];
  /** Bounded non-interactive page text (D1); empty/absent on transactional
   *  and prose-rich pages. */
  prose?: ProjectionProse[];
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
  /** Gated prose (D1): included only for extract/verify modes on prose-poor pages. */
  prose?: ProjectionProse[];
  warnings: RuntimeWarning[];
  stats: OperationalProjection['stats'];
}

export interface SerializedProjectionRef {
  refId: string;
  kind: ProjectionItemKind;
  role?: string;
  name?: string;
  text?: string;
  ariaAutocomplete?: string;
  ariaHasPopup?: string;
  value?: string;
  placeholder?: string;
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
