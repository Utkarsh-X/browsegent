import { getRuntimeConfig, resolveLlmSelection } from './config/runtime';
import { BrowserAgentRunner } from './v2/public/BrowserAgentRunner';
import type { BrowserAgentRunOptions, BrowserAgentRunResult } from './v2/public/types';
import * as v2AgentLoopFactory from './v2/agent/createV2AgentLoop';

export interface BrowseGentOptions {
  model?: string;           // default: read from centralized runtime config
  headless?: boolean;       // default: true
  profileDir?: string;      // default: 'logs/stealth-profile'
  warmup?: boolean;         // default: true
  maxSteps?: number;        // default: 15
  pageWaitMs?: number;      // default: 5000
}

export interface RunResult {
  success: boolean;
  value: string;
  failureReason?: string;
  metrics: {
    llmCallCount: number;
    llmCallReasons: string[];
    inputTokens: number;
    outputTokens: number;
    llmDurationMs: number;
    totalSteps: number;
    totalTimeMs: number;
    brain1WalkMs: number;
    snapshotNodes: number;
    totalDOMNodes: number;
    snapshotTokens: number;
    attributionRate: number;
    causeBreakdown: Record<string, number>;
    model: string;
    estimatedCostUsd: number;
    progress: {
      assessedActions: number;
      strongActions: number;
      weakActions: number;
      noEffectActions: number;
      noProgressAborts: number;
      decisionCounts: {
        accept: number;
        watch: number;
        warn: number;
        abort: number;
      };
      signalCounts: Record<string, number>;
    };
  };
}

export interface ExtractResult<T = unknown> {
  success: boolean;
  data: T | null;
  rawJson?: string;
  failureReason?: string;
  metrics: RunResult['metrics'];
}

export class BrowseGent {
  private opts: Required<BrowseGentOptions>;
  private initialized = false;
  public page: unknown = null;

  constructor(options: BrowseGentOptions = {}) {
    const runtime = getRuntimeConfig();
    const llmSelection = resolveLlmSelection(options.model);

    this.opts = {
      model: llmSelection.modelId,
      headless: options.headless ?? runtime.browser.headless,
      profileDir: options.profileDir ?? runtime.browser.profileDir,
      warmup: options.warmup ?? runtime.browser.warmup,
      maxSteps: options.maxSteps ?? runtime.browser.maxSteps,
      pageWaitMs: options.pageWaitMs ?? runtime.browser.pageWaitMs,
    };
  }

  async init(): Promise<void> {
    this.initialized = true;
  }

  async run(url: string, goal: string): Promise<RunResult>;
  async run(task: string, options: BrowserAgentRunOptions): Promise<BrowserAgentRunResult>;
  async run(first: string, second: string | BrowserAgentRunOptions): Promise<RunResult | BrowserAgentRunResult> {
    if (typeof second !== 'string') {
      return this._runTaskFirstAgent(first, second);
    }

    return this._runV2Agent(first, second);
  }

  async extract<T = unknown>(
    url: string,
    instruction: string,
    schemaDescription: string,
    parseResult?: (raw: unknown) => T,
  ): Promise<ExtractResult<T>> {
    return this._extractV2Agent<T>(url, instruction, schemaDescription, parseResult);
  }

  async close(): Promise<void> {
    this.initialized = false;
    this.page = null;
  }

  private async _runTaskFirstAgent(task: string, options: BrowserAgentRunOptions): Promise<BrowserAgentRunResult> {
    const runtime = getRuntimeConfig();
    const model = resolveLlmSelection(options.model ?? this.opts.model).modelId;
    const runner = new BrowserAgentRunner({
      defaultMaxSteps: this.opts.maxSteps,
      defaultModel: model,
      defaultTraceDir: runtime.v2.traceDir,
      runtimeHeaded: runtime.v2.headed,
    });

    return runner.run(task, options);
  }

  private async _runV2Agent(url: string, goal: string): Promise<RunResult> {
    this._assertInit();
    const t0 = Date.now();
    const runtime = getRuntimeConfig();

    try {
      const result = await v2AgentLoopFactory.v2AgentLoopFactory.create({
        headed: runtime.v2.headed,
        traceDir: runtime.v2.traceDir,
      }).run({
        url,
        goal,
        maxSteps: this.opts.maxSteps,
        model: this.opts.model,
      });

      const duration = Date.now() - t0;
      const metrics = this._emptyMetrics(t0);

      metrics.llmCallCount = result.metrics.plannerCalls;
      metrics.llmCallReasons = Array.from({ length: result.metrics.plannerCalls }, (_, index) => `v2_agent_step_${index + 1}`);
      metrics.inputTokens = result.metrics.inputTokens;
      metrics.outputTokens = result.metrics.outputTokens;
      metrics.llmDurationMs = result.metrics.plannerDurationMs;
      metrics.totalSteps = result.steps;
      metrics.totalTimeMs = duration;
      metrics.estimatedCostUsd = this._cost(this.opts.model, result.metrics.inputTokens, result.metrics.outputTokens);

      return {
        success: result.success,
        value: result.value,
        failureReason: result.failureReason,
        metrics,
      };
    } catch (error) {
      return this._fail(`v2_agent_error: ${error instanceof Error ? error.message : String(error)}`, t0);
    }
  }

  private async _extractV2Agent<T = unknown>(
    url: string,
    instruction: string,
    _schemaDescription: string,
    parseResult?: (raw: unknown) => T,
  ): Promise<ExtractResult<T>> {
    const runResult = await this._runV2Agent(url, instruction);

    if (!runResult.success) {
      return {
        success: false,
        data: null,
        rawJson: runResult.value,
        failureReason: runResult.failureReason,
        metrics: runResult.metrics,
      };
    }

    try {
      const parsed = JSON.parse(runResult.value);
      return {
        success: true,
        data: parseResult ? parseResult(parsed) : (parsed as T),
        rawJson: runResult.value,
        metrics: runResult.metrics,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        rawJson: runResult.value,
        failureReason: `JSON parse failed: ${String(error)}`,
        metrics: runResult.metrics,
      };
    }
  }

  private _assertInit(): void {
    if (!this.initialized) {
      this.initialized = true;
    }
  }

  private _cost(model: string, inputTokens: number, outputTokens: number): number {
    const normalized = model.toLowerCase();

    if (normalized.startsWith('gemini/')) {
      return ((inputTokens * 0.075) + (outputTokens * 0.30)) / 1_000_000;
    }

    if (normalized.startsWith('cerebras/')) {
      return ((inputTokens * 0.60) + (outputTokens * 0.60)) / 1_000_000;
    }

    if (normalized.startsWith('openai/')) {
      return ((inputTokens * 0.15) + (outputTokens * 0.60)) / 1_000_000;
    }

    return ((inputTokens * 0.10) + (outputTokens * 0.40)) / 1_000_000;
  }

  private _fail(reason: string, t0: number): RunResult {
    return { success: false, value: '', failureReason: reason, metrics: this._emptyMetrics(t0) };
  }

  private _emptyMetrics(t0: number): RunResult['metrics'] {
    return {
      llmCallCount: 0,
      llmCallReasons: [],
      inputTokens: 0,
      outputTokens: 0,
      llmDurationMs: 0,
      totalSteps: 0,
      totalTimeMs: Date.now() - t0,
      brain1WalkMs: 0,
      snapshotNodes: 0,
      totalDOMNodes: 0,
      snapshotTokens: 0,
      attributionRate: 0,
      causeBreakdown: {},
      model: this.opts.model,
      estimatedCostUsd: 0,
      progress: {
        assessedActions: 0,
        strongActions: 0,
        weakActions: 0,
        noEffectActions: 0,
        noProgressAborts: 0,
        decisionCounts: {
          accept: 0,
          watch: 0,
          warn: 0,
          abort: 0,
        },
        signalCounts: {},
      },
    };
  }
}
