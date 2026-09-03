import type { BrowserObservation } from '../runtime/types';
import type { PlannerOutputStep, PlannerPressKey } from '../planner/types';
import type { V2ToolResult } from '../runtime/types';

/**
 * Substrate-side verdict for a `seek` iteration. The dispatcher owns only the
 * loop mechanics; the semantic stop condition and progress signature are
 * computed by the caller (agent layer) from the planner's horizon machinery.
 */
export interface SeekIterationVerdict {
  stop: boolean;
  reason?: string;
  /** Identity of the widget window state; identical keys on consecutive
   *  iterations signal a stall and end the seek honestly. */
  progressKey?: string;
}

export interface V2ToolDispatchContext {
  goal: string;
  /** Stop-condition evaluator for `seek` iterations; absent = seek unsupported. */
  seekStop?: (observation: BrowserObservation) => SeekIterationVerdict;
}

export interface V2ToolRuntime {
  click(refId: string): Promise<V2ToolResult>;
  type(refId: string, text: string): Promise<V2ToolResult>;
  navigate(url: string): Promise<V2ToolResult<{ url: string }>>;
  get(refId: string): Promise<V2ToolResult<{ text: string; value?: string }>>;
  inspectRegion(refId: string): Promise<V2ToolResult<{ refId: string; text: string; nearbyRefs: string[] }>>;
  searchPage(pattern: string): Promise<V2ToolResult<{ matches: number; preview: string[]; text?: string }>>;
  scroll(direction?: 'down' | 'up'): Promise<V2ToolResult<{ direction: 'down' | 'up' }>>;
  waitForState(input: { pattern?: string; timeout?: number }): Promise<V2ToolResult<{ matched: boolean }>>;
  press(key: PlannerPressKey): Promise<V2ToolResult<{ key: PlannerPressKey }>>;
  select(refId: string, value: string): Promise<V2ToolResult<{ value: string }>>;
  /** Fresh observation for `seek` iterations; absent = seek unsupported. */
  observe?(): Promise<BrowserObservation>;
}

export interface V2ToolDispatcherLike {
  dispatch(step: PlannerOutputStep, context: V2ToolDispatchContext): Promise<V2ToolResult>;
}
