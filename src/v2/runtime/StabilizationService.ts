import type { Page } from 'playwright';

export interface StabilizationResult {
  durationMs: number;
  timedOut: boolean;
}

export interface StabilizationOptions {
  loadStateTimeoutMs?: number;
  quietWindowMs?: number;
}

export class StabilizationService {
  async waitForSettledState(page: Page, options: StabilizationOptions = {}): Promise<StabilizationResult> {
    const startedAt = Date.now();
    const loadStateTimeoutMs = options.loadStateTimeoutMs ?? 1_000;
    const quietWindowMs = options.quietWindowMs ?? 75;
    let timedOut = false;

    try {
      await page.waitForLoadState('domcontentloaded', { timeout: loadStateTimeoutMs });
    } catch {
      timedOut = true;
    }

    await page.waitForTimeout(quietWindowMs);

    return {
      durationMs: Date.now() - startedAt,
      timedOut,
    };
  }
}
