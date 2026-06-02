export interface RequestPacerClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export type RequestPacerEnv = Record<string, string | undefined>;

export class RequestPacer {
  private lastRequestStartedAt: number | undefined;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly clock: RequestPacerClock = {
    now: () => Date.now(),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  }) {}

  async wait(minIntervalMs: number): Promise<void> {
    if (minIntervalMs <= 0) return;

    const waitTurn = this.queue.then(async () => {
      const now = this.clock.now();
      const elapsed = this.lastRequestStartedAt === undefined
        ? minIntervalMs
        : now - this.lastRequestStartedAt;
      const waitMs = Math.max(0, minIntervalMs - elapsed);
      if (waitMs > 0) {
        await this.clock.sleep(waitMs);
      }
      this.lastRequestStartedAt = this.clock.now();
    });

    this.queue = waitTurn.catch(() => undefined);
    await waitTurn;
  }
}

export function readRequestMinIntervalMs(env: RequestPacerEnv = process.env): number {
  const raw = env.BROWSEGENT_GEMINI_MIN_INTERVAL_MS?.trim();
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

const geminiRequestPacer = new RequestPacer();

export async function waitForGeminiRequestSlot(env: RequestPacerEnv = process.env): Promise<void> {
  await geminiRequestPacer.wait(readRequestMinIntervalMs(env));
}
