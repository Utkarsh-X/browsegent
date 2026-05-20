import type { PlannerOutputStep } from '../planner/types';
import type { V2ToolResult } from '../runtime/types';

export interface V2ToolDispatchContext {
  goal: string;
}

export interface V2ToolRuntime {
  click(refId: string): Promise<V2ToolResult>;
  type(refId: string, text: string): Promise<V2ToolResult>;
  get(refId: string): Promise<V2ToolResult<{ text: string; value?: string }>>;
  inspectRegion(refId: string): Promise<V2ToolResult<{ refId: string; text: string; nearbyRefs: string[] }>>;
  searchPage(pattern: string): Promise<V2ToolResult<{ matches: number; preview: string[] }>>;
  scroll(direction?: 'down' | 'up'): Promise<V2ToolResult<{ direction: 'down' | 'up' }>>;
  waitForState(input: { pattern?: string; timeout?: number }): Promise<V2ToolResult<{ matched: boolean }>>;
}

export interface V2ToolDispatcherLike {
  dispatch(step: PlannerOutputStep, context: V2ToolDispatchContext): Promise<V2ToolResult>;
}
