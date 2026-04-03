import type { BrowserContext, Page } from 'playwright';
import { launchStealth, warmupProfile } from './stealth/launchStealth';
import { createGraph } from './brain2/graphUpdater';
import { runAgentLoop } from './agent/loop';
import { serializeGraph, type ActionHistoryEntry } from './graph/serializer';
import { callExtract } from './agent/llm';
import { logger } from './logger';
import type { SemanticGraph } from './graph/types';
import type { Brain1Result } from './brain1/types';
import { Brain1Service } from './brain1/service';
import { DomBrowserAdapter } from './executor/adapters/domAdapter';
import { PlaywrightBrowserAdapter } from './executor/adapters/playwrightAdapter';
import { Executor } from './executor/executor';
import { createDefaultRegistry } from './executor/registry';
import { getRuntimeConfig, resolveLlmSelection } from './config/runtime';

export interface BrowseGentOptions {
  model?: string;           // default: read from centralized runtime config
  headless?: boolean;       // default: true
  profileDir?: string;      // default: 'extension/.chrome_profile_api'
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
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private opts: Required<BrowseGentOptions>;
  private initialized = false;

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
    if (this.initialized) return;
    this.context = await launchStealth({ headless: this.opts.headless, profileDir: this.opts.profileDir });
    this.page = this.context.pages()[0] ?? await this.context.newPage();
    if (this.opts.warmup) await warmupProfile(this.context);
    this.initialized = true;
  }

  async run(url: string, goal: string): Promise<RunResult> {
    this._assertInit();
    const t0 = Date.now();
    const executionId = this._createExecutionId();

    await this._navigate(url, goal);
    await this.page!.waitForTimeout(this.opts.pageWaitMs);

    if (!await this._verifyExtension()) {
      return this._fail('Extension not loaded — run: npm run extension:build', t0);
    }

    const snapshot = await this._brain1(goal);
    const totalDOM = await this._domCount();
    const graph = createGraph(snapshot.nodes, url);
    const { tokenCount } = serializeGraph(graph, goal);
    const executor = new Executor({
      executionId,
      registry: createDefaultRegistry(),
      adapters: {
        dom: new DomBrowserAdapter(this.page!),
        playwright: new PlaywrightBrowserAdapter(this.page!),
      },
    });

    // Run the agent loop.
    // beforeStep is the CRITICAL missing wiring from all previous test runners:
    // it pulls live Brain 2 deltas from the page into the graph before each step,
    // so the agent loop sees real-time mutations — not a stale initial snapshot.
    const agentResult = await runAgentLoop({
      goal,
      graph,
      executor,
      maxSteps: this.opts.maxSteps,
      beforeStep: async () => {
        // Sync Brain 2 deltas from page into graph
        await this._syncDeltas(graph);
      },
      afterAct: async () => {
        // Re-observe page with Brain 1 after every action
        // This replaces the stale snapshot with fresh filtered content
        await this._rescanPage(graph, goal);
      },
    });

    const finalDeltas = await this._getDeltas();
    const { attributionRate, causeBreakdown } = this._attribution(finalDeltas);
    const progress = this._summarizeProgress(agentResult.actionHistory);
    const duration = Date.now() - t0;

    logger.info('agent:progress', 'Run progress summary', {
      executionId,
      success: agentResult.success,
      failureReason: agentResult.failureReason,
      ...progress,
    });

    return {
      success: agentResult.success,
      value: agentResult.value ?? '',
      failureReason: agentResult.failureReason,
      metrics: {
        llmCallCount: agentResult.llmCallCount,
        llmCallReasons: agentResult.llmCallReasons,
        inputTokens: agentResult.totalInputTokens,
        outputTokens: agentResult.totalOutputTokens,
        llmDurationMs: agentResult.totalLlmDurationMs,
        totalSteps: agentResult.totalSteps,
        totalTimeMs: duration,
        brain1WalkMs: snapshot.metrics.walkTimeMs ?? 0,
        snapshotNodes: snapshot.nodes.length,
        totalDOMNodes: totalDOM,
        snapshotTokens: tokenCount,
        attributionRate,
        causeBreakdown,
        model: this.opts.model,
        estimatedCostUsd: this._cost(this.opts.model, agentResult.totalInputTokens, agentResult.totalOutputTokens),
        progress,
      },
    };
  }

  async extract<T = unknown>(
    url: string,
    instruction: string,
    schemaDescription: string,
    parseResult?: (raw: unknown) => T
  ): Promise<ExtractResult<T>> {
    this._assertInit();
    const t0 = Date.now();

    await this._navigate(url, instruction);
    await this.page!.waitForTimeout(this.opts.pageWaitMs);

    if (!await this._verifyExtension()) {
      return { success: false, data: null, failureReason: 'Extension not loaded', metrics: this._emptyMetrics(t0) };
    }

    const snapshot = await this._brain1(instruction);
    const totalDOM = await this._domCount();
    const graph = createGraph(snapshot.nodes, url);
    await this._syncDeltas(graph);

    const { serialized, tokenCount } = serializeGraph(graph, instruction);
    const extractResult = await callExtract({
      instruction,
      graphJson: JSON.stringify(serialized),
      schemaDescription,
    });

    let data: T | null = null;
    let parseError: string | undefined;
    try {
      const parsed = JSON.parse(extractResult.rawJson);
      data = parseResult ? parseResult(parsed) : parsed as T;
    } catch (e) {
      parseError = `JSON parse failed: ${String(e)}`;
    }

    const finalDeltas = await this._getDeltas();
    const { attributionRate, causeBreakdown } = this._attribution(finalDeltas);
    const duration = Date.now() - t0;
    const progress = this._summarizeProgress([]);

    return {
      success: data !== null && !parseError,
      data,
      rawJson: extractResult.rawJson,
      failureReason: parseError,
      metrics: {
        llmCallCount: 1,
        llmCallReasons: ['extract'],
        inputTokens: extractResult.inputTokens,
        outputTokens: extractResult.outputTokens,
        llmDurationMs: extractResult.durationMs,
        totalSteps: 1,
        totalTimeMs: duration,
        brain1WalkMs: snapshot.metrics.walkTimeMs ?? 0,
        snapshotNodes: snapshot.nodes.length,
        totalDOMNodes: totalDOM,
        snapshotTokens: tokenCount,
        attributionRate,
        causeBreakdown,
        model: this.opts.model,
        estimatedCostUsd: this._cost(this.opts.model, extractResult.inputTokens, extractResult.outputTokens),
        progress,
      },
    };
  }

  async close(): Promise<void> {
    await this.context?.close();
    this.context = null;
    this.page = null;
    this.initialized = false;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private _assertInit(): void {
    if (!this.initialized || !this.page) throw new Error('Call await bg.init() first.');
  }

  private async _navigate(url: string, goal: string): Promise<void> {
    await this.page!.addInitScript((g: string) => { (window as any).__browsegent_goal = g; }, goal);
    await this.page!.goto(url, { waitUntil: 'domcontentloaded', timeout: 35_000 });
  }

  private async _verifyExtension(): Promise<boolean> {
    for (let i = 0; i < 10; i++) {
      const ok = await this.page!.evaluate(
        () => typeof (window as any).__browsegent_brain2 !== 'undefined'
      ).catch(() => false);
      if (ok) return true;
      await this.page!.waitForTimeout(500);
    }
    return false;
  }

  private async _brain1(goal: string): Promise<Brain1Result> {
    return new Brain1Service(this.page!).scan(goal);
  }

  private async _domCount(): Promise<number> {
    return this.page!.evaluate(() => document.querySelectorAll('*').length);
  }

  private async _syncDeltas(graph: SemanticGraph): Promise<void> {
    graph.pageUrl = this.page!.url();
    const rawDeltas = await this.page!.evaluate(
      () => (window as any).__browsegent_brain2.getDeltas()
    ).catch(() => []);
    for (const delta of rawDeltas) {
      if (!delta.isNoise) {
        const exists = graph.deltas.some(
          (d: any) => d.timestamp === delta.timestamp && d.nodeSelector === delta.nodeSelector
        );
        if (!exists) {
          graph.deltas.push(delta);
          if (graph.deltas.length > 50) graph.deltas.shift();
        }
      }
    }
  }

  /**
   * Re-observes the current page state after an action.
   * Brain 1 rescans, graph snapshot is replaced with fresh data.
   * Brain 2 deltas are cleared — they described the page transition,
   * not the new stable state. Fresh mutations will be captured next cycle.
   *
   * This implements the RE-OBSERVE step in observe→plan→act→re-observe→repeat.
   */
  private async _rescanPage(graph: SemanticGraph, goal: string): Promise<void> {
    try {
      // Wait briefly for page to settle after action
      await this.page!.waitForTimeout(1500);

      // Brain 1 rescan — fresh filtered snapshot
      const freshSnapshot = await this._brain1(goal);

      // Replace snapshot in graph — old data is gone, fresh data is in
      graph.snapshot = freshSnapshot.nodes;
      graph.pageUrl = this.page!.url();
      graph.snapshotTimestamp = Date.now();
      graph.lastUpdateTimestamp = Date.now();

      // Clear Brain 2 deltas — they described the transition, not the new state
      // Fresh mutations after this will be captured by beforeStep next cycle
      await this.page!.evaluate(
        () => (window as any).__browsegent_brain2.clearDeltas()
      ).catch(() => {});

      logger.info('agent:loop', 'Re-observed page after action', {
        freshNodes: freshSnapshot.nodes.length,
        walkMs: freshSnapshot.metrics.walkTimeMs ?? 0,
      });

    } catch (err) {
      // Rescan failure is non-fatal — log and continue with existing snapshot
      logger.warn('agent:loop', 'Re-observe failed, continuing with existing snapshot', {
        err: String(err).slice(0, 100),
      });
    }
  }

  private async _getDeltas(): Promise<any[]> {
    return this.page!.evaluate(() => (window as any).__browsegent_brain2.getDeltas()).catch(() => []);
  }

  private _createExecutionId(): string {
    return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private _attribution(deltas: any[]): { attributionRate: number; causeBreakdown: Record<string, number> } {
    const nonNoise = deltas.filter((d: any) => !d.isNoise);
    const attributed = nonNoise.filter((d: any) => d.chain?.initiator !== 'unknown').length;
    const breakdown: Record<string, number> = {};
    for (const d of nonNoise) {
      const key = d.chain?.initiator === 'unknown'
        ? `unknown(${d.chain?.unknownReason ?? 'none'})`
        : d.chain?.transport
          ? `${d.chain.initiator}+${d.chain.transport}`
          : (d.chain?.initiator ?? 'unknown');
      breakdown[key] = (breakdown[key] ?? 0) + 1;
    }
    return {
      attributionRate: nonNoise.length > 0 ? attributed / nonNoise.length : 0,
      causeBreakdown: breakdown,
    };
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

  private _summarizeProgress(actionHistory: ActionHistoryEntry[]): RunResult['metrics']['progress'] {
    const summary: RunResult['metrics']['progress'] = {
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
    };

    for (const entry of actionHistory) {
      if (entry.effect) {
        summary.assessedActions += 1;
        summary.signalCounts[entry.effect.primarySignal] = (summary.signalCounts[entry.effect.primarySignal] ?? 0) + 1;
        if (entry.effect.strength === 'strong') summary.strongActions += 1;
        if (entry.effect.strength === 'weak') summary.weakActions += 1;
        if (entry.effect.strength === 'none') summary.noEffectActions += 1;
      }

      if (entry.progressDecision) {
        summary.decisionCounts[entry.progressDecision] += 1;
        if (entry.progressDecision === 'abort' || entry.result === 'no_progress') {
          summary.noProgressAborts += 1;
        }
      }
    }

    return summary;
  }

  private _emptyMetrics(t0: number): RunResult['metrics'] {
    return {
      llmCallCount: 0, llmCallReasons: [], inputTokens: 0, outputTokens: 0, llmDurationMs: 0,
      totalSteps: 0, totalTimeMs: Date.now() - t0, brain1WalkMs: 0,
      snapshotNodes: 0, totalDOMNodes: 0, snapshotTokens: 0,
      attributionRate: 0, causeBreakdown: {}, model: this.opts.model, estimatedCostUsd: 0,
      progress: this._summarizeProgress([]),
    };
  }
}
