export type V2RuntimeMode = 'off' | 'mvr' | 'agent';
export type RefState = 'live' | 'weakened' | 'stale' | 'invalid';
export type VisibilityState = 'visible' | 'offscreen' | 'hidden' | 'unknown';
export type ActionabilityState = 'ready' | 'disabled' | 'blocked' | 'unknown';
export type TransitionStrength = 'none' | 'weak' | 'moderate' | 'strong' | 'negative';
export type TransitionClass = 'microstate' | 'structural_local' | 'structural_macrostate' | 'hard_reset';
export type EditableKind = 'none' | 'text' | 'search' | 'contenteditable';

export interface V2RuntimeConfig {
  v2RuntimeMode: V2RuntimeMode;
  traceDir: string;
  headed: boolean;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface V2RefCapabilities {
  clickable: boolean;
  typeable: boolean;
  selectable: boolean;
  readable: boolean;
}

export interface V2Ref {
  refId: string;
  generationId: number;
  targetId: string;
  frameId?: string;
  backendNodeId?: number;
  selectorCandidates: string[];
  role?: string;
  name?: string;
  text?: string;
  tagName?: string;
  inputType?: string;
  editableKind?: EditableKind;
  ariaAutocomplete?: string;
  ariaHasPopup?: string;
  isContentEditable?: boolean;
  nthRoleName?: number;
  capabilities?: V2RefCapabilities;
  selectOptions?: string[];
  regionId?: string;
  box?: Rect;
  visibility: VisibilityState;
  actionability: ActionabilityState;
  continuityConfidence: number;
  state: RefState;
  invalidationReason?: string;
}

export interface RuntimeWarning {
  code: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

export interface BrowserObservation {
  observationId: string;
  sessionId: string;
  generationId: number;
  url: string;
  title: string;
  timestamp: number;
  refs: V2Ref[];
  warnings: RuntimeWarning[];
  stats: {
    refCount: number;
    visibleRefCount: number;
    durationMs: number;
  };
}

export interface TransitionEvidence {
  beforeObservationId: string;
  afterObservationId: string;
  transitionClass: TransitionClass;
  strength: TransitionStrength;
  generationChanged: boolean;
  urlChanged: boolean;
  refChanges: {
    appeared: string[];
    disappeared: string[];
    weakened: string[];
    preserved: string[];
  };
  notes: string[];
}

export interface V2ToolError {
  code: string;
  message: string;
  retryable: boolean;
  diagnostics?: Record<string, unknown>;
}

export interface V2ToolTargetSummary {
  refId: string;
  role?: string;
  name?: string;
  text?: string;
}

export interface V2ToolResult<TValue = unknown> {
  success: boolean;
  kind: string;
  targetRef?: string;
  target?: V2ToolTargetSummary;
  value?: TValue;
  error?: V2ToolError;
  evidence?: TransitionEvidence;
  traceStepId: string;
}
