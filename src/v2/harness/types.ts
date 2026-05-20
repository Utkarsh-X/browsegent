import type { BrowserSessionOptions } from '../substrate/types';
import type { V2RuntimeMode } from '../runtime/types';

export interface BrowseGentV2HarnessOptions extends BrowserSessionOptions {
  runId?: string;
  sessionId?: string;
  traceDir?: string;
  runtimeMode?: V2RuntimeMode;
}
