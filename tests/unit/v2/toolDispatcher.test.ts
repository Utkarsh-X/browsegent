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
  ];

  const results = [];
  for (const step of steps) {
    results.push(await dispatcher.dispatch(step, { goal: 'read Alpha' }));
  }

  assert.deepEqual(
    runtime.calls.map(call => call.method),
    ['click', 'type', 'get', 'inspectRegion', 'searchPage', 'scroll', 'waitForState'],
  );
  assert.deepEqual(runtime.calls[1].args, ['ref_input', 'Ada']);
  assert.deepEqual(runtime.calls[6].args, [{ pattern: 'Ready', timeout: 250 }]);
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

  const unsupported = await dispatcher.dispatch({ tool: 'navigate' } as unknown as PlannerOutputStep, { goal: 'open page' });
  const missingRef = await dispatcher.dispatch({ tool: 'click' }, { goal: 'click button' });
  const missingText = await dispatcher.dispatch({ tool: 'type', ref: 'ref_input' }, { goal: 'fill input' });

  assert.equal(unsupported.success, false);
  assert.equal(unsupported.error?.code, 'unsupported_tool');
  assert.equal(unsupported.error?.retryable, false);
  assert.equal(missingRef.success, false);
  assert.equal(missingRef.error?.code, 'missing_ref');
  assert.equal(missingText.success, false);
  assert.equal(missingText.error?.code, 'missing_text');
  assert.equal(runtime.calls.length, 0);
});

test('v2 public barrel exports the tool dispatcher surface', async () => {
  const v2 = await import('../../../src/v2');

  assert.equal(typeof v2.V2ToolDispatcher, 'function');
});
