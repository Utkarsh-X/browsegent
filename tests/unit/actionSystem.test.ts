import test from 'node:test';
import assert from 'node:assert/strict';

import { buildGeminiResponseSchema, buildToolSignatureBlock, getValidActionKinds } from '../../src/executor/catalog';
import { AdapterError } from '../../src/executor/browserAdapter';
import type { BrowserAdapter } from '../../src/executor/browserAdapter';
import { Executor } from '../../src/executor/executor';
import { normalizePlanStep } from '../../src/executor/normalize';
import { createDefaultRegistry } from '../../src/executor/registry';
import type { BrowserRuntimeState } from '../../src/executor/types';
import type { Action, ActionErrorCode } from '../../src/executor/types';

class FakeAdapter implements BrowserAdapter {
  runtime: 'dom' | 'playwright';
  calls: string[] = [];
  clickImpl?: (target: string) => Promise<void>;

  constructor(runtime: 'dom' | 'playwright', private readonly available = true) {
    this.runtime = runtime;
  }

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  async captureState(target?: string): Promise<BrowserRuntimeState> {
    this.calls.push(`state:${target ?? '(none)'}`);
    return {
      url: 'https://example.com/page',
      baseUrl: 'https://example.com/page',
      hash: '',
      scrollX: 0,
      scrollY: 0,
      focusKey: undefined,
      targetFound: !!target,
      targetValue: target,
      domSignature: 'stable',
    };
  }

  async click(target: string): Promise<void> {
    this.calls.push(`click:${target}`);
    if (this.clickImpl) {
      await this.clickImpl(target);
    }
  }

  async type(target: string, input: string): Promise<void> {
    this.calls.push(`type:${target}:${input}`);
  }

  async scroll(direction: 'down' | 'up'): Promise<void> {
    this.calls.push(`scroll:${direction}`);
  }

  async readValue(target: string): Promise<{ found: boolean; value: string }> {
    this.calls.push(`read:${target}`);
    return { found: true, value: target };
  }

  async selectOption(target: string, option: string): Promise<void> {
    this.calls.push(`select:${target}:${option}`);
  }

  async waitForPattern(pattern: string, timeoutMs: number): Promise<boolean> {
    this.calls.push(`wait:${pattern}:${timeoutMs}`);
    return true;
  }

  async sleep(timeoutMs: number): Promise<void> {
    this.calls.push(`sleep:${timeoutMs}`);
  }

  async recordClickCause(target: string): Promise<void> {
    this.calls.push(`record:${target}`);
  }
}

function buildAction(overrides: Partial<Action> = {}): Action {
  return {
    kind: 'click',
    target: '#submit',
    origin: 'llm',
    original: { tool: 'click', sel: '#submit' },
    ...overrides,
  };
}

test('normalizePlanStep preserves external schema and normalizes fields', () => {
  const action = normalizePlanStep({
    tool: 'type',
    sel: 'input[name="q"]',
    text: 'BrowseGent',
    timeout: 1500,
  });

  assert.deepEqual(action, {
    kind: 'type',
    target: 'input[name="q"]',
    input: 'BrowseGent',
    option: undefined,
    direction: undefined,
    timeoutMs: 1500,
    pattern: undefined,
    origin: 'llm',
    original: {
      tool: 'type',
      sel: 'input[name="q"]',
      text: 'BrowseGent',
      timeout: 1500,
    },
  });
});

test('catalog drives tool signature and provider schema', () => {
  const signatures = buildToolSignatureBlock();
  for (const kind of getValidActionKinds()) {
    assert.match(signatures, new RegExp(`"tool":"${kind}"`));
  }

  const schema = buildGeminiResponseSchema() as {
    properties: { plan: { items: { properties: Record<string, unknown> } } };
  };
  assert.ok(schema.properties.plan.items.properties.tool);
  assert.ok(schema.properties.plan.items.properties.sel);
  assert.ok(schema.properties.plan.items.properties.timeout);
});

test('executor falls back from dom to playwright on recoverable error', async () => {
  const dom = new FakeAdapter('dom');
  dom.clickImpl = async () => {
    throw new AdapterError('not_found', 'missing', 'dom');
  };

  const playwright = new FakeAdapter('playwright');

  const executor = new Executor({
    executionId: 'exec-test',
    registry: createDefaultRegistry(),
    adapters: { dom, playwright },
  });

  const result = await executor.execute(buildAction());

  assert.equal(result.success, true);
  assert.deepEqual(result.metadata.runtimePath, ['dom', 'playwright']);
  assert.equal(result.metadata.usedFallback, true);
  assert.equal(result.metadata.finalRuntime, 'playwright');
  assert.ok(dom.calls.includes('record:#submit'));
  assert.ok(playwright.calls.includes('click:#submit'));
});

test('executor records a no-effect summary for unchanged successful clicks', async () => {
  const dom = new FakeAdapter('dom');
  const playwright = new FakeAdapter('playwright', false);
  const executor = new Executor({
    executionId: 'exec-effect',
    registry: createDefaultRegistry(),
    adapters: { dom, playwright },
  });

  const result = await executor.execute(buildAction());

  assert.equal(result.success, true);
  assert.equal(result.metadata.effect?.primarySignal, 'none');
  assert.equal(result.metadata.effect?.stateChanged, false);
});

test('executor returns validation failure without runtime execution', async () => {
  const dom = new FakeAdapter('dom');
  const playwright = new FakeAdapter('playwright');
  const executor = new Executor({
    executionId: 'exec-invalid',
    registry: createDefaultRegistry(),
    adapters: { dom, playwright },
  });

  const result = await executor.execute(buildAction({ target: undefined }));

  assert.equal(result.success, false);
  assert.equal(result.error?.code, 'invalid_action' satisfies ActionErrorCode);
  assert.equal(result.metadata.finalRuntime, 'none');
  assert.deepEqual(dom.calls, []);
  assert.deepEqual(playwright.calls, []);
});
