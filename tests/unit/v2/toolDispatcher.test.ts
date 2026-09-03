import test from 'node:test';
import assert from 'node:assert/strict';

import type { PlannerOutputStep } from '../../../src/v2/planner/types';
import type { V2ToolResult } from '../../../src/v2/runtime/types';

async function loadDispatcherModule() {
  try {
    return await import('../../../src/v2/tools/V2ToolDispatcher');
  } catch (error) {
    assert.fail(`expected v2 tool dispatcher module to exist: ${(error as Error).message}`);
  }
}

async function loadToolTypesModule() {
  try {
    return await import('../../../src/v2/tools/types');
  } catch (error) {
    assert.fail(`expected v2 tool runtime types module to exist: ${(error as Error).message}`);
  }
}

class FakeToolRuntime {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];

  async click(refId: string): Promise<V2ToolResult> {
    this.calls.push({ method: 'click', args: [refId] });
    return { success: true, kind: 'click', targetRef: refId, traceStepId: `trace_${this.calls.length}` };
  }

  async type(refId: string, text: string): Promise<V2ToolResult<{ inputValue: string }>> {
    this.calls.push({ method: 'type', args: [refId, text] });
    return { success: true, kind: 'type', targetRef: refId, value: { inputValue: text }, traceStepId: `trace_${this.calls.length}` };
  }

  async get(refId: string): Promise<V2ToolResult<{ text: string; value?: string }>> {
    this.calls.push({ method: 'get', args: [refId] });
    return { success: true, kind: 'get', targetRef: refId, value: { text: 'Alpha' }, traceStepId: `trace_${this.calls.length}` };
  }

  async inspectRegion(refId: string): Promise<V2ToolResult<{ refId: string; text: string; nearbyRefs: string[] }>> {
    this.calls.push({ method: 'inspectRegion', args: [refId] });
    return {
      success: true,
      kind: 'inspect_region',
      targetRef: refId,
      value: { refId, text: 'Region text', nearbyRefs: ['ref_next'] },
      traceStepId: `trace_${this.calls.length}`,
    };
  }

  async searchPage(pattern: string): Promise<V2ToolResult<{ matches: number; preview: string[] }>> {
    this.calls.push({ method: 'searchPage', args: [pattern] });
    return { success: true, kind: 'search_page', value: { matches: 1, preview: ['Alpha match'] }, traceStepId: `trace_${this.calls.length}` };
  }

  async scroll(direction?: 'down' | 'up'): Promise<V2ToolResult<{ direction: 'down' | 'up' }>> {
    this.calls.push({ method: 'scroll', args: [direction] });
    return { success: true, kind: 'scroll', value: { direction: direction ?? 'down' }, traceStepId: `trace_${this.calls.length}` };
  }

  async waitForState(input: { pattern?: string; timeout?: number }): Promise<V2ToolResult<{ matched: boolean }>> {
    this.calls.push({ method: 'waitForState', args: [input] });
    return { success: true, kind: 'wait', value: { matched: true }, traceStepId: `trace_${this.calls.length}` };
  }

  async navigate(url: string): Promise<V2ToolResult<{ url: string }>> {
    this.calls.push({ method: 'navigate', args: [url] });
    return { success: true, kind: 'navigate', value: { url }, traceStepId: `trace_${this.calls.length}` };
  }

  async press(key: 'Enter' | 'Escape' | 'Tab' | 'ArrowDown' | 'ArrowUp'): Promise<V2ToolResult<{ key: typeof key }>> {
    this.calls.push({ method: 'press', args: [key] });
    return { success: true, kind: 'press', value: { key }, traceStepId: `trace_${this.calls.length}` };
  }

  async select(refId: string, value: string): Promise<V2ToolResult<{ value: string }>> {
    this.calls.push({ method: 'select', args: [refId, value] });
    return { success: true, kind: 'select', targetRef: refId, value: { value }, traceStepId: 'fake_select' };
  }
}

test('V2ToolDispatcher dispatches ref-first planner steps to runtime tools', async () => {
  const { V2ToolDispatcher } = await loadDispatcherModule();
  await loadToolTypesModule();
  const runtime = new FakeToolRuntime();
  const dispatcher = new V2ToolDispatcher(runtime);

  const steps: PlannerOutputStep[] = [
    { tool: 'click', ref: 'ref_button' },
    { tool: 'type', ref: 'ref_input', text: 'Ada' },
    { tool: 'get', ref: 'ref_answer' },
    { tool: 'inspect_region', ref: 'ref_region' },
    { tool: 'search_page', pattern: 'Alpha' },
    { tool: 'scroll', direction: 'up' },
    { tool: 'wait', pattern: 'Ready', timeout: 250 },
    { tool: 'press', key: 'Enter' },
    { tool: 'navigate', url: 'https://example.test/next' },
    { tool: 'select', ref: 'v2ref_1', value: 'Announcement date (newest first)' },
  ];

  const results = [];
  for (const step of steps) {
    results.push(await dispatcher.dispatch(step, { goal: 'read Alpha' }));
  }

  assert.deepEqual(
    runtime.calls.map(call => call.method),
    ['click', 'type', 'get', 'inspectRegion', 'searchPage', 'scroll', 'waitForState', 'press', 'navigate', 'select'],
  );
  assert.deepEqual(runtime.calls[1].args, ['ref_input', 'Ada']);
  assert.deepEqual(runtime.calls[6].args, [{ pattern: 'Ready', timeout: 250 }]);
  assert.deepEqual(runtime.calls[7].args, ['Enter']);
  assert.deepEqual(runtime.calls[8].args, ['https://example.test/next']);
  assert.deepEqual(runtime.calls[9].args, ['v2ref_1', 'Announcement date (newest first)']);
  assert.equal(results.every(result => result.success), true);
});

test('V2ToolDispatcher maps close to a bounded click on the provided ref', async () => {
  const { V2ToolDispatcher } = await loadDispatcherModule();
  const runtime = new FakeToolRuntime();
  const dispatcher = new V2ToolDispatcher(runtime);

  const result = await dispatcher.dispatch({ tool: 'close', ref: 'ref_modal_close' }, { goal: 'close modal' });

  assert.equal(result.success, true);
  assert.deepEqual(runtime.calls, [{ method: 'click', args: ['ref_modal_close'] }]);
});

test('V2ToolDispatcher returns operational failures for unsupported or malformed steps', async () => {
  const { V2ToolDispatcher } = await loadDispatcherModule();
  const runtime = new FakeToolRuntime();
  const dispatcher = new V2ToolDispatcher(runtime);

  const unsupported = await dispatcher.dispatch({ tool: 'unknown_tool' } as unknown as PlannerOutputStep, { goal: 'open page' });
  const missingRef = await dispatcher.dispatch({ tool: 'click' }, { goal: 'click button' });
  const missingText = await dispatcher.dispatch({ tool: 'type', ref: 'ref_input' }, { goal: 'fill input' });
  const missingUrl = await dispatcher.dispatch({ tool: 'navigate' } as PlannerOutputStep, { goal: 'open page' });
  const unsafeUrl = await dispatcher.dispatch({ tool: 'navigate', url: 'data:text/html,<script>alert(1)</script>' }, { goal: 'open page' });
  const invalidPress = await dispatcher.dispatch({ tool: 'press', key: 'Control+L' } as unknown as PlannerOutputStep, { goal: 'submit form' });

  assert.equal(unsupported.success, false);
  assert.equal(unsupported.error?.code, 'unsupported_tool');
  assert.equal(unsupported.error?.retryable, false);
  assert.equal(missingRef.success, false);
  assert.equal(missingRef.error?.code, 'missing_ref');
  assert.equal(missingText.success, false);
  assert.equal(missingText.error?.code, 'missing_text');
  assert.equal(missingUrl.success, false);
  assert.equal(missingUrl.error?.code, 'missing_url');
  assert.equal(unsafeUrl.success, false);
  assert.equal(unsafeUrl.error?.code, 'unsupported_url');
  assert.equal(invalidPress.success, false);
  assert.equal(invalidPress.error?.code, 'invalid_key');

  const missingValue = await dispatcher.dispatch({ tool: 'select', ref: 'v2ref_1' }, { goal: 'Sort results' });
  assert.equal(missingValue.success, false);
  assert.equal(missingValue.error?.code, 'missing_value');

  assert.equal(runtime.calls.length, 0);
});

test('v2 public barrel exports the tool dispatcher surface', async () => {
  const v2 = await import('../../../src/v2');

  assert.equal(typeof v2.V2ToolDispatcher, 'function');
});

// ---- seek macro ----

import type { BrowserObservation } from '../../../src/v2/runtime/types';
import type { SeekIterationVerdict, V2ToolDispatchContext } from '../../../src/v2/tools/types';

class SeekFakeRuntime {
  clickCount = 0;
  observations: Array<BrowserObservation | null>;
  failClickAt: number | null = null;

  constructor(observations: Array<BrowserObservation | null>, failClickAt: number | null = null) {
    this.observations = observations;
    this.failClickAt = failClickAt;
  }

  async click(): Promise<V2ToolResult> {
    this.clickCount += 1;
    if (this.failClickAt !== null && this.clickCount === this.failClickAt) {
      return {
        success: false,
        kind: 'click',
        traceStepId: 'trace_fail',
        error: { code: 'stale_ref', message: 'Ref no longer resolves.', retryable: false },
      };
    }
    return { success: true, kind: 'click', targetRef: 'ref_nav', traceStepId: `trace_${this.clickCount}` };
  }

  async observe(): Promise<BrowserObservation | null> {
    return this.observations[Math.min(this.clickCount, this.observations.length) - 1];
  }
}

function makeSeekVerdicts(keys: string[], stopAt: number | null): (obs: unknown) => SeekIterationVerdict {
  let index = 0;
  return () => {
    const key = keys[Math.min(index, keys.length - 1)];
    index += 1;
    if (stopAt !== null && index >= stopAt) {
      return { stop: true, reason: 'target_reachable', progressKey: key };
    }
    return { stop: false, reason: 'window_advancing', progressKey: key };
  };
}

function seekContext(verdicts: (obs: unknown) => SeekIterationVerdict): V2ToolDispatchContext {
  return { goal: 'Find a hotel for December 25-26', seekStop: verdicts };
}

test('seek loops click-observe until the stop condition reports the target reachable', async () => {
  const { V2ToolDispatcher } = await loadDispatcherModule();
  const runtime = new SeekFakeRuntime([{} as BrowserObservation, {} as BrowserObservation, {} as BrowserObservation]);
  const dispatcher = new V2ToolDispatcher(runtime as never);
  const result = await dispatcher.dispatch(
    { tool: 'seek', ref: 'ref_nav' } as PlannerOutputStep,
    seekContext(makeSeekVerdicts(['Sep,Oct', 'Oct,Nov', 'Nov,Dec'], 3)),
  );

  assert.equal(result.success, true);
  assert.equal(result.kind, 'seek');
  assert.equal((result.value as { iterationCount: number }).iterationCount, 3);
  assert.equal((result.value as { stopReason: string }).stopReason, 'target_reachable');
  assert.equal(runtime.clickCount, 3);
});

test('seek stops honestly when the window stops advancing (stall)', async () => {
  const { V2ToolDispatcher } = await loadDispatcherModule();
  const runtime = new SeekFakeRuntime([{} as BrowserObservation, {} as BrowserObservation]);
  const dispatcher = new V2ToolDispatcher(runtime as never);
  const result = await dispatcher.dispatch(
    { tool: 'seek', ref: 'ref_nav' } as PlannerOutputStep,
    seekContext(makeSeekVerdicts(['Sep,Oct', 'Sep,Oct'], null)),
  );

  assert.equal(result.success, false);
  assert.equal((result.value as { stopReason: string }).stopReason, 'seek_stalled');
  assert.equal(runtime.clickCount, 2);
});

test('seek fails honestly on a click error mid-loop', async () => {
  const { V2ToolDispatcher } = await loadDispatcherModule();
  const runtime = new SeekFakeRuntime([{} as BrowserObservation], 2);
  const dispatcher = new V2ToolDispatcher(runtime as never);
  const result = await dispatcher.dispatch(
    { tool: 'seek', ref: 'ref_nav' } as PlannerOutputStep,
    seekContext(makeSeekVerdicts(['Sep,Oct'], null)),
  );

  assert.equal(result.success, false);
  assert.equal(result.error?.code, 'stale_ref');
  assert.equal(runtime.clickCount, 2);
});

test('seek enforces the iteration cap', async () => {
  const { V2ToolDispatcher } = await loadDispatcherModule();
  const observations = Array.from({ length: 10 }, () => ({}) as BrowserObservation);
  const runtime = new SeekFakeRuntime(observations);
  const dispatcher = new V2ToolDispatcher(runtime as never);
  const result = await dispatcher.dispatch(
    { tool: 'seek', ref: 'ref_nav' } as PlannerOutputStep,
    seekContext(makeSeekVerdicts(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'], null)),
  );

  assert.equal(result.success, false);
  assert.equal((result.value as { stopReason: string }).stopReason, 'seek_iteration_cap');
  assert.equal(runtime.clickCount, 8);
});

test('seek rejects missing ref and unsupported runtimes without acting', async () => {
  const { V2ToolDispatcher } = await loadDispatcherModule();
  const runtime = new SeekFakeRuntime([]);
  const dispatcher = new V2ToolDispatcher(runtime as never);

  const missingRef = await dispatcher.dispatch({ tool: 'seek' } as PlannerOutputStep, seekContext(makeSeekVerdicts([], null)));
  assert.equal(missingRef.success, false);
  assert.equal(missingRef.error?.code, 'missing_ref');

  const unsupported = await dispatcher.dispatch(
    { tool: 'seek', ref: 'ref_nav' } as PlannerOutputStep,
    { goal: 'g' },
  );
  assert.equal(unsupported.success, false);
  assert.equal(unsupported.error?.code, 'seek_unsupported');
  assert.equal(runtime.clickCount, 0);
});
