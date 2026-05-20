import type { RefState, V2Ref } from './types';

export interface RefResolution {
  ref?: V2Ref;
  state: RefState;
  confidence: number;
  reason?: string;
}

export interface RefComparison {
  appeared: string[];
  disappeared: string[];
  weakened: string[];
  preserved: string[];
}
