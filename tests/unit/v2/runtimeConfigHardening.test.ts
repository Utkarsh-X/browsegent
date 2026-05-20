import test from 'node:test';
import assert from 'node:assert/strict';

import { loadV2RuntimeConfig, V2RuntimeConfigError } from '../../../src/v2/runtime/config';

test('v2 browser execution defaults to headless unless explicitly headed', () => {
  const config = loadV2RuntimeConfig({});

  assert.equal(config.v2RuntimeMode, 'off');
  assert.equal(config.headed, false);
});

test('v2 headed mode is explicit and strict', () => {
  assert.equal(loadV2RuntimeConfig({ BROWSEGENT_V2_HEADED: 'true' }).headed, true);
  assert.equal(loadV2RuntimeConfig({ BROWSEGENT_V2_HEADED: 'false' }).headed, false);
  assert.throws(
    () => loadV2RuntimeConfig({ BROWSEGENT_V2_HEADED: 'maybe' }),
    (error: unknown) => {
      assert.ok(error instanceof V2RuntimeConfigError);
      assert.match(error.message, /BROWSEGENT_V2_HEADED/);
      return true;
    },
  );
});
