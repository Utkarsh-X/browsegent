import test from 'node:test';
import assert from 'node:assert/strict';

import { normalize, robustJsonParse } from '../../src/agent/parser';

// ── Regression: value field preserved in plan steps ─────────────────────────
// Root cause: FIELD_MAP mapped 'value' → 'val' for top-level answer fields,
// but the same map was applied to plan step fields where 'value' means the
// select dropdown value, not the final answer. This caused `select requires
// "value"` validation errors even when the planner correctly emitted value.

test('normalize preserves value field inside plan steps for select', () => {
  const result = normalize({
    plan: [
      { tool: 'select', ref: 'v2ref_493', value: 'Submission date (newest first)' },
      { tool: 'click', ref: 'v2ref_1466' },
    ],
    confidence: 'high',
  });

  assert.ok(result);
  const plan = result.plan as Array<Record<string, unknown>>;
  assert.equal(plan[0].value, 'Submission date (newest first)');
  assert.equal(plan[0].val, undefined);
  assert.equal(plan[0].tool, 'select');
  assert.equal(plan[1].tool, 'click');
});

test('normalize still maps top-level value to val for done responses', () => {
  const result = normalize({
    done: true,
    value: 'Castle Mountains National Monument',
  });

  assert.ok(result);
  assert.equal(result.val, 'Castle Mountains National Monument');
  assert.equal(result.value, undefined);
});

test('normalize maps action→tool in plan steps but not value→val', () => {
  const result = normalize({
    plan: [
      { action: 'type', selector: 'ref_search', value: 'climate change' },
    ],
    confidence: 'medium',
  });

  assert.ok(result);
  const plan = result.plan as Array<Record<string, unknown>>;
  // action → tool (STEP_FIELD_MAP)
  assert.equal(plan[0].tool, 'type');
  // selector → sel (STEP_FIELD_MAP)
  assert.equal(plan[0].sel, 'ref_search');
  // value stays as value (NOT mapped to val)
  assert.equal(plan[0].value, 'climate change');
  assert.equal(plan[0].val, undefined);
});

test('robustJsonParse end-to-end preserves select value through full pipeline', () => {
  const raw = `{
  "plan": [
    {
      "tool": "select",
      "ref": "v2ref_493",
      "value": "Submission date (newest first)"
    },
    {
      "tool": "click",
      "ref": "v2ref_1466"
    }
  ],
  "confidence": "high"
}`;

  const result = robustJsonParse(raw);
  assert.ok(result);
  const plan = result.plan as Array<Record<string, unknown>>;
  assert.equal(plan[0].value, 'Submission date (newest first)');
  assert.equal(plan[0].tool, 'select');
});
