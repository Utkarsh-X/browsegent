import type { Page } from 'playwright';

export interface StabilizationResult {
  durationMs: number;
  timedOut: boolean;
}

export interface StabilizationOptions {
  loadStateTimeoutMs?: number;
  quietWindowMs?: number;
  /** Mutation-quiet requirement before the capture (D3). Absent sampler =
   *  legacy fixed-window behavior. */
  mutationQuietMs?: number;
  /** Hard cap on the whole settle, including the mutation wait. */
  maxSettleMs?: number;
}

export class StabilizationService {
  async waitForSettledState(page: Page, options: StabilizationOptions = {}): Promise<StabilizationResult> {
    const startedAt = Date.now();
    const loadStateTimeoutMs = options.loadStateTimeoutMs ?? 5_000;
    const quietWindowMs = options.quietWindowMs ?? 75;
    const mutationQuietMs = options.mutationQuietMs ?? 150;
    const maxSettleMs = options.maxSettleMs ?? 1_200;
    let timedOut = false;

    try {
      await page.waitForLoadState('domcontentloaded', { timeout: loadStateTimeoutMs });
    } catch {
      timedOut = true;
    }

    await page.waitForTimeout(quietWindowMs);

    // D3: SPA hydration and popover re-renders routinely land inside the old
    // fixed window, producing empty or weakened captures. When the page
    // carries the mutation sampler, extend the wait (bounded) until the DOM
    // has been quiet for mutationQuietMs. Pages without the sampler keep the
    // exact legacy behavior.
    const deadline = startedAt + maxSettleMs;
    while (Date.now() < deadline) {
      const quietFor = await page.evaluate(() => {
        const store = window as unknown as { __bgSettle?: { lastMutationTs: number } };
        const settle = store.__bgSettle;
        return settle ? Date.now() - settle.lastMutationTs : undefined;
      }).catch(() => undefined);
      if (quietFor === undefined) break;
      if (quietFor >= mutationQuietMs) break;
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await page.waitForTimeout(Math.min(50, remaining)).catch(() => undefined);
    }

    return {
      durationMs: Date.now() - startedAt,
      timedOut,
    };
  }
}
