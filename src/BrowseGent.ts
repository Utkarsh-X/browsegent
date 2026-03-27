import type { BrowserContext, Page } from 'playwright';
import { launchStealth, warmupProfile } from './stealth/launchStealth';
import { createGraph } from './brain2/graphUpdater';
import { runAgentLoop } from './agent/loop';
import { serializeGraph } from './graph/serializer';
import { callExtract } from './agent/llm';
import { logger } from './logger';
import type { SemanticGraph } from './graph/types';

export interface BrowseGentOptions {
  model?: string;           // default: read from BROWSEGENT_MODEL env or 'gemini-2.5-flash'
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
    this.opts = {
      model: options.model ?? process.env['BROWSEGENT_MODEL'] ?? 'gemini-2.5-flash',
      headless: options.headless ?? true,
      profileDir: options.profileDir ?? 'extension/.chrome_profile_api',
      warmup: options.warmup ?? true,
      maxSteps: options.maxSteps ?? 15,
      pageWaitMs: options.pageWaitMs ?? 5000,
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

    await this._navigate(url, goal);
    await this.page!.waitForTimeout(this.opts.pageWaitMs);

    if (!await this._verifyExtension()) {
      return this._fail('Extension not loaded — run: npm run extension:build', t0);
    }

    const snapshot = await this._brain1(goal);
    const totalDOM = await this._domCount();
    const graph = createGraph(snapshot.nodes, url);
    const { tokenCount } = serializeGraph(graph, goal);

    // Run the agent loop.
    // beforeStep is the CRITICAL missing wiring from all previous test runners:
    // it pulls live Brain 2 deltas from the page into the graph before each step,
    // so the agent loop sees real-time mutations — not a stale initial snapshot.
    const agentResult = await runAgentLoop({
      goal,
      graph,
      ctx: { page: this.page! },
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
    const duration = Date.now() - t0;

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
        brain1WalkMs: snapshot.walkTimeMs ?? 0,
        snapshotNodes: snapshot.nodes.length,
        totalDOMNodes: totalDOM,
        snapshotTokens: tokenCount,
        attributionRate,
        causeBreakdown,
        model: this.opts.model,
        estimatedCostUsd: this._cost(this.opts.model, agentResult.totalInputTokens, agentResult.totalOutputTokens),
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
        brain1WalkMs: snapshot.walkTimeMs ?? 0,
        snapshotNodes: snapshot.nodes.length,
        totalDOMNodes: totalDOM,
        snapshotTokens: tokenCount,
        attributionRate,
        causeBreakdown,
        model: this.opts.model,
        estimatedCostUsd: this._cost(this.opts.model, extractResult.inputTokens, extractResult.outputTokens),
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

  private async _brain1(goal: string): Promise<any> {
    return this.page!.evaluate((g: string) => (window as any).__browsegent_brain1(document.body, g), goal);
  }

  private async _domCount(): Promise<number> {
    return this.page!.evaluate(() => document.querySelectorAll('*').length);
  }

  private async _syncDeltas(graph: SemanticGraph): Promise<void> {
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
      graph.snapshotTimestamp = Date.now();
      graph.lastUpdateTimestamp = Date.now();

      // Clear Brain 2 deltas — they described the transition, not the new state
      // Fresh mutations after this will be captured by beforeStep next cycle
      await this.page!.evaluate(
        () => (window as any).__browsegent_brain2.clearDeltas()
      ).catch(() => {});

      logger.info('agent:loop', 'Re-observed page after action', {
        freshNodes: freshSnapshot.nodes.length,
        walkMs: freshSnapshot.walkTimeMs ?? 0,
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
    const pricing: Record<string, { input: number; output: number }> = {
      'gemini-2.5-flash': { input: 0.075, output: 0.30 },
      'gemini-1.5-pro':   { input: 3.50,  output: 10.50 },
      'gemini-1.5-flash': { input: 0.075, output: 0.30 },
    };
    const entry = Object.entries(pricing).find(([k]) => model.includes(k))?.[1]
      ?? { input: 0.10, output: 0.40 };
    return ((inputTokens * entry.input) + (outputTokens * entry.output)) / 1_000_000;
  }

  private _fail(reason: string, t0: number): RunResult {
    return { success: false, value: '', failureReason: reason, metrics: this._emptyMetrics(t0) };
  }

  private _emptyMetrics(t0: number): RunResult['metrics'] {
    return {
      llmCallCount: 0, llmCallReasons: [], inputTokens: 0, outputTokens: 0, llmDurationMs: 0,
      totalSteps: 0, totalTimeMs: Date.now() - t0, brain1WalkMs: 0,
      snapshotNodes: 0, totalDOMNodes: 0, snapshotTokens: 0,
      attributionRate: 0, causeBreakdown: {}, model: this.opts.model, estimatedCostUsd: 0,
    };
  }
}
