import type { V2AgentLoopResult } from '../agent/types';

export type BrowserAgentOutputMode =
  | 'text'
  | {
      type: 'json';
      schemaDescription?: string;
    };

export interface BrowserAgentViewport {
  width: number;
  height: number;
}

export interface BrowserAgentBrowserOptions {
  headless?: boolean;
  viewport?: BrowserAgentViewport;
  profileDir?: string;
  cdpUrl?: string;
}

export interface BrowserAgentTraceOptions {
  dir?: string;
  runId?: string;
}

export interface BrowserAgentRunOptions {
  url: string;
  model?: string;
  maxSteps?: number;
  browser?: BrowserAgentBrowserOptions;
  trace?: boolean | BrowserAgentTraceOptions;
  output?: BrowserAgentOutputMode;
}

export interface BrowserAgentRunResult {
  success: boolean;
  value: string;
  data?: unknown;
  failureReason?: string;
  tracePath?: string;
  warnings: string[];
  metrics: V2AgentLoopResult['metrics'];
}
