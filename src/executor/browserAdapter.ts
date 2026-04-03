import type { Page } from 'playwright';
import type { ActionErrorCode, BrowserRuntime, BrowserRuntimeState } from './types';

export interface BrowserAdapter {
  runtime: Exclude<BrowserRuntime, 'none'>;
  isAvailable(): Promise<boolean>;
  captureState(target?: string): Promise<BrowserRuntimeState>;
  click(target: string): Promise<void>;
  type(target: string, input: string, opts?: { clear: boolean }): Promise<void>;
  scroll(direction: 'down' | 'up'): Promise<void>;
  readValue(target: string): Promise<{ found: boolean; value: string }>;
  selectOption(target: string, option: string): Promise<void>;
  waitForPattern(pattern: string, timeoutMs: number): Promise<boolean>;
  sleep(timeoutMs: number): Promise<void>;
  recordClickCause?(target: string): Promise<void>;
}

export interface AdapterPageContext {
  page?: Page;
}

export class AdapterError extends Error {
  constructor(
    public readonly code: ActionErrorCode,
    message: string,
    public readonly runtime: Exclude<BrowserRuntime, 'none'>,
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}
