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
    // has been quiet for mutationQuietMs. The wait loop runs IN-PAGE (one
    // round trip, D3.1) instead of polling evaluate from Node. Pages without
    // the sampler keep the exact legacy behavior.
    const remainingCapMs = Math.max(0, maxSettleMs - (Date.now() - startedAt));
    if (remainingCapMs > quietWindowMs) {
      await page.evaluate(async ({ quietMs, capMs }: { quietMs: number; capMs: number }) => {
        const store = window as unknown as { __bgSettle?: { lastMutationTs: number } };
        const settle = store.__bgSettle;
        if (!settle) return;
        const deadline = Date.now() + capMs;
        while (Date.now() < deadline) {
          if (Date.now() - settle.lastMutationTs >= quietMs) return;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
      }, { quietMs: mutationQuietMs, capMs: remainingCapMs }).catch(() => undefined);
    }

    return {
      durationMs: Date.now() - startedAt,
      timedOut,
    };
  }
}
