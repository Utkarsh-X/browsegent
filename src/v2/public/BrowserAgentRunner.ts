import { v2AgentLoopFactory, type V2AgentLoopFactoryInput } from '../agent/createV2AgentLoop';
import type { V2AgentLoopResult } from '../agent/types';
import type { BrowserAgentRunOptions, BrowserAgentRunResult } from './types';

export interface BrowserAgentRunnerOptions {
  defaultMaxSteps: number;
  defaultModel: string;
  defaultTraceDir: string;
  runtimeHeaded: boolean;
  loopFactory?: (
    input: V2AgentLoopFactoryInput,
  ) => {
    run(input: { url: string; goal: string; maxSteps: number; model?: string }): Promise<V2AgentLoopResult>;
  };
}

export class BrowserAgentRunner {
  private readonly loopFactory: NonNullable<BrowserAgentRunnerOptions['loopFactory']>;

  constructor(private readonly options: BrowserAgentRunnerOptions) {
    this.loopFactory = options.loopFactory ?? (input => v2AgentLoopFactory.create(input));
  }

  async run(task: string, options: BrowserAgentRunOptions): Promise<BrowserAgentRunResult> {
    if (!task.trim()) {
      return this.failure('public_task_empty', []);
    }
    if (!options.url?.trim()) {
      return this.failure('public_url_missing', []);
    }

    const warnings = buildWarnings(options);
    const traceOptions = resolveTraceOptions(options.trace, this.options.defaultTraceDir);
    const headed = options.browser?.headless === undefined
      ? this.options.runtimeHeaded
      : !options.browser.headless;
    const maxSteps = Math.max(1, options.maxSteps ?? this.options.defaultMaxSteps);
    const loop = this.loopFactory({
      headed,
      traceDir: traceOptions.traceDir,
      runId: traceOptions.runId,
      viewport: options.browser?.viewport,
    });
    const loopResult = await loop.run({
      url: options.url,
      goal: buildGoal(task, options),
      maxSteps,
      model: options.model ?? this.options.defaultModel,
    });

    return applyOutputMode(loopResult, options, warnings);
  }

  private failure(failureReason: string, warnings: string[]): BrowserAgentRunResult {
    return {
      success: false,
      value: '',
      failureReason,
      warnings,
      metrics: {
        plannerCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        plannerDurationMs: 0,
        toolExecutions: 0,
      },
    };
  }
}

function buildGoal(task: string, options: BrowserAgentRunOptions): string {
  if (typeof options.output === 'object' && options.output.type === 'json' && options.output.schemaDescription) {
    return `${task}\n\nReturn JSON matching this schema description: ${options.output.schemaDescription}`;
  }

  return task;
}

function buildWarnings(options: BrowserAgentRunOptions): string[] {
  const warnings: string[] = [];
  if (options.browser?.cdpUrl) {
    warnings.push('browser.cdpUrl is accepted but not used by the local v2 runner in this release slice.');
  }
  if (options.browser?.profileDir) {
    warnings.push('browser.profileDir is accepted but not used by the local v2 runner in this release slice.');
  }
  if (options.trace === false) {
    warnings.push('trace=false requested, but v2 agent mode always records traces for replayability.');
  }
  return warnings;
}

function resolveTraceOptions(
  trace: BrowserAgentRunOptions['trace'],
  defaultTraceDir: string,
): { traceDir: string; runId?: string } {
  if (typeof trace === 'object' && trace !== null) {
    return {
      traceDir: trace.dir ?? defaultTraceDir,
      runId: trace.runId,
    };
  }

  return { traceDir: defaultTraceDir };
}

function applyOutputMode(
  loopResult: V2AgentLoopResult,
  options: BrowserAgentRunOptions,
  warnings: string[],
): BrowserAgentRunResult {
  if (typeof options.output === 'object' && options.output.type === 'json' && loopResult.success) {
    try {
      return {
        success: true,
        value: loopResult.value,
        data: JSON.parse(loopResult.value),
        tracePath: loopResult.tracePath,
        warnings,
        metrics: loopResult.metrics,
      };
    } catch (error) {
      return {
        success: false,
        value: loopResult.value,
        failureReason: `output_json_parse_failed:${error instanceof Error ? error.message : String(error)}`,
        tracePath: loopResult.tracePath,
        warnings,
        metrics: loopResult.metrics,
      };
    }
  }

  return {
    success: loopResult.success,
    value: loopResult.value,
    failureReason: loopResult.failureReason,
    tracePath: loopResult.tracePath,
    warnings,
    metrics: loopResult.metrics,
  };
}
