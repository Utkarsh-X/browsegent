import type { Page } from 'playwright';

import type { ActionabilityState, Rect, RuntimeWarning, V2Ref, VisibilityState } from '../runtime/types';

export interface BrowserSessionOptions {
  headed?: boolean;
  viewport?: {
    width: number;
    height: number;
  };
}

export interface ObservationCaptureInput {
  sessionId: string;
  generationId: number;
  page: Page;
}

export interface BuildObservationInput {
  observationId: string;
  sessionId: string;
  generationId: number;
  url: string;
  title: string;
  timestamp: number;
  durationMs: number;
  refs: V2Ref[];
  warnings: RuntimeWarning[];
}

export interface CapturedElement {
  targetId: string;
  selectorCandidates: string[];
  tagName: string;
  role?: string;
  name?: string;
  text?: string;
  box?: Rect;
  visibility: VisibilityState;
  actionability: ActionabilityState;
}
