import { BrowseGent } from '../../../../src/BrowseGent';
import type { BrowserAgentRunOptions, BrowserAgentRunResult } from '../../../../src';
import type { BenchmarkAdapter, BenchmarkAdapterRunOptions, BenchmarkAdapterResult, BenchmarkTask } from '../types';

export interface BrowseGentBenchmarkAdapterOptions {
  clientFactory?: () => {
    run(task: string, options: BrowserAgentRunOptions): Promise<BrowserAgentRunResult>;
  };
}

export class BrowseGentBenchmarkAdapter implements BenchmarkAdapter {
  readonly adapterId = 'browsegent';

  constructor(private readonly options: BrowseGentBenchmarkAdapterOptions = {}) {}

  async run(task: BenchmarkTask, options: BenchmarkAdapterRunOptions): Promise<BenchmarkAdapterResult> {
    const startedAt = Date.now();
    const client = this.options.clientFactory?.() ?? new BrowseGent({
      maxSteps: options.maxSteps ?? task.maxSteps ?? 8,
      warmup: false,
    });

    try {
      const result = await client.run(task.goal, {
        url: task.url,
        model: options.model,
        maxSteps: options.maxSteps ?? task.maxSteps,
        browser: { headless: !options.headed },
        trace: { dir: options.traceDir, runId: `${options.runId}_${task.taskId}_a${options.attempt}` },
        output: 'text',
      });

      return {
        adapterId: this.adapterId,
        taskId: task.taskId,
        attempt: options.attempt,
        success: result.success,
        value: result.value,
        tracePath: result.tracePath,
        failureReason: result.failureReason,
        metrics: {
          plannerCalls: result.metrics.plannerCalls,
          toolExecutions: result.metrics.toolExecutions,
          durationMs: Date.now() - startedAt,
          inputTokens: result.metrics.inputTokens,
          outputTokens: result.metrics.outputTokens,
        },
      };
    } catch (error) {
      return {
        adapterId: this.adapterId,
        taskId: task.taskId,
        attempt: options.attempt,
        success: false,
        value: '',
        failureReason: error instanceof Error ? error.message : String(error),
        failureType: 'runtime_crash',
        metrics: {
          plannerCalls: 0,
          toolExecutions: 0,
          durationMs: Date.now() - startedAt,
        },
      };
    }
  }
}
