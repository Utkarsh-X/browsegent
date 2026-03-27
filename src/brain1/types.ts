export type NodeType = 'data' | 'trigger' | 'input' | 'table_cell';
export type SelectorType = 'id' | 'aria' | 'name' | 'testid' | 'positional';

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
    href?: string;
    inputType?: string;
  };
}

export interface Brain1Result {
  nodes: FilteredNode[];
  metrics: {
    totalNodesWalked: number;
    nodesKept: number;
    nodesDropped: number;
    walkTimeMs: number;
    rulesTriggered: Record<string, number>;
    selectorTypes: Record<string, number>;
  };
  errors: string[];
}
