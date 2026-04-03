export type NodeType = 'data' | 'trigger' | 'input' | 'table_cell';
export type SelectorType =
  | 'id'
  | 'aria'
  | 'name'
  | 'testid'
  | 'href'
  | 'placeholder'
  | 'role'
  | 'type'
  | 'positional';
export type VisibilityState = 'visible' | 'offscreen' | 'hidden';
export type InteractionKind = 'link' | 'button' | 'input' | 'select' | 'editable' | 'toggle' | 'generic';
export type Brain1Confidence = 'high' | 'medium' | 'low';
export type Brain1EnrichmentState = 'base' | 'enriched';

export interface FilteredNodeMeta {
  nodeId: string;
  selectorScore: number;
  interactionScore: number;
  actionabilityScore: number;
  interactionKind: InteractionKind;
  confidence: Brain1Confidence;
  enrichmentState: Brain1EnrichmentState;
  visibility: VisibilityState;
  goalScore?: number;
  regionSelector?: string;
  disabled?: boolean;
  shadow?: boolean;
  role?: string;
  selectorSource?: SelectorType;
}

export interface FilteredNode {
  type: NodeType;
  tag: string;
  value: string;
  sel: string;
  selType: SelectorType;
  rule: string;
  attrs?: {
    placeholder?: string;
    ariaLabel?: string;
    name?: string;
    href?: string;
    inputType?: string;
    role?: string;
    dataTestId?: string;
  };
  meta?: FilteredNodeMeta;
}

export interface Brain1Metrics {
  totalNodesWalked: number;
  nodesKept: number;
  nodesDropped: number;
  walkTimeMs: number;
  shadowDomCount: number;
  rulesTriggered: Record<string, number>;
  selectorTypes: Record<string, number>;
}

export interface Brain1Result {
  nodes: FilteredNode[];
  metrics: Brain1Metrics;
  errors: string[];
}
