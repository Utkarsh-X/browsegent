import test from 'node:test';
import assert from 'node:assert/strict';

import { loadV2RuntimeConfig, V2RuntimeConfigError } from '../../../src/v2/runtime/config';
import { V2_OPERATIONAL_ERROR_CODES } from '../../../src/v2/runtime/errors';

test('v2 runtime config defaults to off with deterministic trace settings', () => {
  const config = loadV2RuntimeConfig({});

  assert.equal(config.v2RuntimeMode, 'off');
  assert.equal(config.traceDir, 'logs/v2-runs');
  assert.equal(config.headed, false);
});

test('v2 runtime config accepts explicit mvr mode and trace settings', () => {
  const config = loadV2RuntimeConfig({
    BROWSEGENT_V2_RUNTIME: 'mvr',
    BROWSEGENT_V2_TRACE_DIR: 'logs/custom-v2',
    BROWSEGENT_V2_HEADED: 'false',
  });

  assert.equal(config.v2RuntimeMode, 'mvr');
  assert.equal(config.traceDir, 'logs/custom-v2');
  assert.equal(config.headed, false);
});

test('v2 runtime config accepts explicit agent mode without changing the default', () => {
  const config = loadV2RuntimeConfig({
    BROWSEGENT_V2_RUNTIME: 'agent',
  });

  assert.equal(config.v2RuntimeMode, 'agent');
});

test('v2 runtime config rejects unsupported runtime modes', () => {
  assert.throws(
    () => loadV2RuntimeConfig({ BROWSEGENT_V2_RUNTIME: 'auto' }),
    (error: unknown) => {
      assert.ok(error instanceof V2RuntimeConfigError);
      assert.match(error.message, /Unsupported BROWSEGENT_V2_RUNTIME/);
      return true;
    },
  );
});

test('v2 public error code set is operational and non-strategic', () => {
  assert.deepEqual(
    V2_OPERATIONAL_ERROR_CODES,
    [
      'invalid_runtime_mode',
      'target_not_found',
      'target_hidden',
      'target_disabled',
      'target_blocked',
      'stale_ref',
      'low_confidence_ref',
      'timeout',
      'navigation_interrupted',
      'trace_write_failed',
    ],
  );
});
