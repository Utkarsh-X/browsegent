import type { BrowserAdapter } from './browserAdapter';

export type ActionKind = 'click' | 'type' | 'scroll' | 'wait' | 'get' | 'close' | 'select';
export type BrowserRuntime = 'dom' | 'playwright' | 'none';
export type ActionOrigin = 'llm';
export type ActionEffectSignal =
  | 'none'
  | 'url_changed'
  | 'hash_changed'
  | 'scroll_changed'
  | 'focus_changed'
  | 'dom_changed'
  | 'target_value_changed'
  | 'target_value_observed';
export type ActionEffectStrength = 'none' | 'weak' | 'strong';
export type ActionErrorCode =
  | 'invalid_action'
  | 'not_found'
  | 'not_interactable'
  | 'timeout'
  | 'blocked'
  | 'unsupported_runtime'
  | 'execution_error';

export interface LLMPlanStep {
  tool: ActionKind;
  sel?: string;
  text?: string;
  value?: string;
  direction?: 'down' | 'up';
  timeout?: number;
  pattern?: string;
}

export interface Action {
  kind: ActionKind;
  target?: string;
  input?: string;
  option?: string;
  direction?: 'down' | 'up';
  timeoutMs?: number;
  pattern?: string;
  origin: ActionOrigin;
  original: LLMPlanStep;
}

export interface ActionError {
  code: ActionErrorCode;
  message: string;
  retryable: boolean;
  shouldReplan: boolean;
  runtime: BrowserRuntime;
}

export interface BrowserRuntimeState {
  url: string;
  baseUrl: string;
  hash: string;
  scrollX: number;
  scrollY: number;
  focusKey?: string;
  targetFound?: boolean;
  targetValue?: string;
  domSignature: string;
}

export interface ActionEffectSummary {
  stateChanged: boolean;
  primarySignal: ActionEffectSignal;
  signals: ActionEffectSignal[];
  strength: ActionEffectStrength;
  targetValue?: string;
}

export interface ActionResult {
  success: boolean;
  kind: ActionKind;
  value?: string;
  error?: ActionError;
  metadata: {
    attempts: number;
    durationMs: number;
    runtimePath: Array<'dom' | 'playwright'>;
    finalRuntime: BrowserRuntime;
    usedFallback: boolean;
    target?: string;
    mutating: boolean;
    effect?: ActionEffectSummary;
  };
}

export interface ValidationOk<TValidated extends Action = Action> {
  ok: true;
  value: TValidated;
}

export interface ValidationErr {
  ok: false;
  error: ActionError;
}

export type ValidationResult<TValidated extends Action = Action> = ValidationOk<TValidated> | ValidationErr;

export interface RetryPolicy {
  maxDomAttempts: number;
  allowPlaywrightFallback: boolean;
  shouldRetry(error: ActionError, attempt: number): boolean;
}

export interface AttemptMeta {
  executionId: string;
  actionId: string;
  runtime: BrowserRuntime;
  attempt: number;
  startedAt: number;
  runtimePath: Array<'dom' | 'playwright'>;
  usedFallback: boolean;
  mutating: boolean;
  effect?: ActionEffectSummary;
}

export interface ActionExecutionContext {
  adapter: BrowserAdapter;
  executionId: string;
  actionId: string;
  runtime: Exclude<BrowserRuntime, 'none'>;
  attempt: number;
}

export interface ExecutorHookMeta {
  executionId: string;
  actionId: string;
  startedAt: number;
}

export type BeforeExecuteHook = (action: Action, meta: ExecutorHookMeta) => void | Promise<void>;
export type AfterExecuteHook = (result: ActionResult, meta: ExecutorHookMeta) => void | Promise<void>;
export type FailureHook = (result: ActionResult, meta: ExecutorHookMeta) => void | Promise<void>;

export interface ExecutorHooks {
  beforeExecute?: BeforeExecuteHook[];
  afterExecute?: AfterExecuteHook[];
  onFailure?: FailureHook[];
}

export interface ActionFieldSpec {
  name: keyof LLMPlanStep;
  required: boolean;
  type: 'string' | 'number' | 'enum';
  enumValues?: string[];
}

export interface ActionLlmSpec {
  externalName: ActionKind;
  description: string;
  fields: ActionFieldSpec[];
}

export interface ActionDefinition<TValidated extends Action = Action, TRaw = unknown> {
  kind: ActionKind;
  llmSpec: ActionLlmSpec;
  validate(action: Action): ValidationResult<TValidated>;
  execute(action: TValidated, ctx: ActionExecutionContext): Promise<TRaw>;
  normalizeSuccess(raw: TRaw, action: TValidated, meta: AttemptMeta): ActionResult;
  normalizeFailure(error: unknown, action: TValidated, meta: AttemptMeta): ActionError;
  retryPolicy: RetryPolicy;
}
