import type { V1CompatibilityAdapterConfig, V1ExtractInput, V1RunInput } from './types';

export class V1CompatibilityAdapter<TRunResult = unknown, TExtractResult = unknown> {
  private constructor(private readonly config: V1CompatibilityAdapterConfig<TRunResult, TExtractResult>) {}

  static create<TRunResult, TExtractResult>(
    config: V1CompatibilityAdapterConfig<TRunResult, TExtractResult>,
  ): V1CompatibilityAdapter<TRunResult, TExtractResult> {
    return new V1CompatibilityAdapter(config);
  }

  run(input: V1RunInput): Promise<TRunResult> {
    if (this.config.runtimeMode === 'mvr') {
      return this.config.runV2Diagnostic(input);
    }

    if (this.config.runtimeMode === 'agent') {
      return this.config.runV2Agent(input);
    }

    return this.config.runV1(input);
  }

  extract<T = unknown>(input: V1ExtractInput<T>): Promise<TExtractResult> {
    if (this.config.runtimeMode === 'mvr') {
      return this.config.extractV2Diagnostic(input);
    }

    if (this.config.runtimeMode === 'agent') {
      return this.config.extractV2Agent(input);
    }

    return this.config.extractV1(input);
  }
}
