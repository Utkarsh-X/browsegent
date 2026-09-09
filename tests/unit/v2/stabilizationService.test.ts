import test from 'node:test';
import assert from 'node:assert/strict';


test('mutation-aware settle waits for DOM quiet up to the hard cap', async () => {
  const { StabilizationService } = await import('../../../src/v2/runtime/StabilizationService');
  let settle = { lastMutationTs: Date.now() };
  const waits: number[] = [];
  const page = {
    waitForLoadState: async () => undefined,
    waitForTimeout: async (ms: number) => {
      waits.push(ms);
      await new Promise(resolve => setTimeout(resolve, Math.min(ms, 10)));
      settle.lastMutationTs = Date.now() - Math.max(0, 200 - waits.length * 10);
    },
    evaluate: async () => Date.now() - settle.lastMutationTs,
  };

  const service = new StabilizationService();
  const result = await service.waitForSettledState(page as never, { quietWindowMs: 1, mutationQuietMs: 150, maxSettleMs: 400 });
  assert.ok(waits.length > 0, 'polling happened while mutations were recent');
  assert.ok(result.durationMs < 1_000, 'hard cap respected');
});

test('settle returns immediately when the sampler reports long quiet', async () => {
  const { StabilizationService } = await import('../../../src/v2/runtime/StabilizationService');
  const waits: number[] = [];
  const page = {
    waitForLoadState: async () => undefined,
    waitForTimeout: async (ms: number) => { waits.push(ms); },
    evaluate: async () => 10_000, // quiet for 10s
  };
  const service = new StabilizationService();
  const result = await service.waitForSettledState(page as never, { quietWindowMs: 5, mutationQuietMs: 150, maxSettleMs: 1_200 });
  assert.deepEqual(waits, [5], 'only the legacy floor ran');
  assert.ok(result.durationMs < 200);
});

test('pages without the sampler keep the legacy fixed-window behavior', async () => {
  const { StabilizationService } = await import('../../../src/v2/runtime/StabilizationService');
  const waits: number[] = [];
  const page = {
    waitForLoadState: async () => undefined,
    waitForTimeout: async (ms: number) => { waits.push(ms); },
    evaluate: async () => undefined, // sampler absent
  };
  const service = new StabilizationService();
  await service.waitForSettledState(page as never, { quietWindowMs: 75, mutationQuietMs: 150 });
  assert.deepEqual(waits, [75], 'no polling beyond the legacy floor');
});
