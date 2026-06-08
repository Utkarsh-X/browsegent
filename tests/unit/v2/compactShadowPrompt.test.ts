import { test } from 'node:test';
import assert from 'node:assert';
import { buildCompactShadowSystemPrompt, buildCompactShadowUserMessage } from '../../../src/v2/planner/CompactShadowPrompt';
import type { CompactShadowPlannerInput } from '../../../src/v2/planner/CompactShadowInput';

test('buildCompactShadowSystemPrompt assertions', () => {
  const sysPrompt = buildCompactShadowSystemPrompt();
  
  // system prompt includes "compact indexes"
  assert.match(sysPrompt, /compact indexes/i);
  
  // system prompt says "Return only JSON"
  assert.match(sysPrompt, /Return only JSON/i);
  
  // system prompt forbids selectors, XPath, coordinates, scripts, and invented indexes
  assert.match(sysPrompt, /selector/i);
  assert.match(sysPrompt, /xpath/i);
  assert.match(sysPrompt, /coordinate/i);
  assert.match(sysPrompt, /script/i);
  assert.match(sysPrompt, /invented/i);
  
  // system prompt does not mention "current.refs", "workingSet.primaryRefs", or "selectorCandidates"
  assert.ok(!sysPrompt.includes('current.refs'), 'Should not mention current.refs');
  assert.ok(!sysPrompt.includes('workingSet.primaryRefs'), 'Should not mention workingSet.primaryRefs');
  assert.ok(!sysPrompt.includes('selectorCandidates'), 'Should not mention selectorCandidates');
});

test('buildCompactShadowUserMessage assertions', () => {
  const input: CompactShadowPlannerInput = {
    version: 'compact_shadow_input.v1',
    goal: 'click the login button',
    actions: [
      { index: 'a1', role: 'button', label: 'Login', tools: ['click'] }
    ],
    reads: []
  };
  
  const userMessage = buildCompactShadowUserMessage(input);
  
  // user message must be exactly "Compact planner input JSON:\n${JSON.stringify(input)}"
  assert.strictEqual(userMessage, `Compact planner input JSON:\n${JSON.stringify(input)}`);
  
  // user message includes JSON with "index" values
  assert.match(userMessage, /"index":"a1"/);
  
  // user message does not include runtime refs if only compact input is passed
  assert.ok(!userMessage.includes('ref_'), 'Should not contain runtime refs like ref_');
});
