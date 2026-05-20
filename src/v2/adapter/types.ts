import type { V2RuntimeMode } from '../runtime/types';

export interface V1RunInput {
  url: string;
  goal: string;
}

export interface V1ExtractInput<T = unknown> {
  url: string;
  instruction: string;
  schemaDescription: string;
  parseResult?: (raw: unknown) => T;
}

export interface V1CompatibilityAdapterConfig<TRunResult, TExtractResult> {
  runtimeMode: V2RuntimeMode;
  runV1: (input: V1RunInput) => Promise<TRunResult>;
  extractV1: (input: V1ExtractInput) => Promise<TExtractResult>;
  runV2Diagnostic: (input: V1RunInput) => Promise<TRunResult>;
  extractV2Diagnostic: (input: V1ExtractInput) => Promise<TExtractResult>;
  runV2Agent: (input: V1RunInput) => Promise<TRunResult>;
  extractV2Agent: (input: V1ExtractInput) => Promise<TExtractResult>;
}
