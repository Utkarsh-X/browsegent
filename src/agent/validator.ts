// ── validator.ts — Semantic Correctness ─────────────────────────────────────
// "Is this output actually usable?" — not just "did it parse?"
// Returns specific error messages for targeted retry feedback.

const VALID_TOOLS = new Set(['click', 'type', 'scroll', 'wait', 'get', 'close', 'select']);
const VALID_ESCALATIONS = new Set(['user_needed', 'captcha', 'dead_end']);
const TOOLS_REQUIRING_SEL = new Set(['click', 'type', 'get', 'close', 'select']);

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validatePlan(plan: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  const hasPlan = Array.isArray(plan['plan']) && (plan['plan'] as unknown[]).length > 0;
  const hasDone = plan['done'] === true;
  const hasVal = !!plan['val'];
  const hasEscalate = !!plan['escalate'];

  // Must have at least one intent
  if (!hasPlan && !hasDone && !hasVal && !hasEscalate) {
    errors.push('Response has no "plan", "done", "val", or "escalate" — no recognizable intent');
    return { valid: false, errors };
  }

  // done:true must have val
  if (hasDone && !hasVal) {
    errors.push('"done" is true but "val" field is missing — include the answer in "val"');
  }

  // done:false with empty plan
  if (plan['done'] === false && !hasPlan && !hasEscalate) {
    errors.push('"done" is false but "plan" is empty — provide action steps or escalate');
  }

  // Validate escalate value
  if (hasEscalate && typeof plan['escalate'] === 'string') {
    if (!VALID_ESCALATIONS.has(plan['escalate'] as string)) {
      errors.push(
        `"escalate" has unknown value "${plan['escalate']}"; use: ${[...VALID_ESCALATIONS].join(', ')}`
      );
    }
  }

  // Validate plan steps
  if (hasPlan) {
    const steps = plan['plan'] as Record<string, unknown>[];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (typeof step !== 'object' || step === null) {
        errors.push(`Step ${i + 1} is not an object`);
        continue;
      }

      // Must have tool
      if (!step['tool']) {
        errors.push(`Step ${i + 1} is missing "tool" field`);
        continue;
      }

      // Tool must be known
      if (typeof step['tool'] === 'string' && !VALID_TOOLS.has(step['tool'])) {
        errors.push(
          `Step ${i + 1} has unknown tool "${step['tool']}"; use: ${[...VALID_TOOLS].join(', ')}`
        );
      }

      // Tools that need sel must have sel
      if (typeof step['tool'] === 'string' && TOOLS_REQUIRING_SEL.has(step['tool']) && !step['sel']) {
        errors.push(`Step ${i + 1} uses "${step['tool']}" but "sel" (selector) is missing`);
      }

      // type tool needs text
      if (step['tool'] === 'type' && !step['text']) {
        errors.push(`Step ${i + 1} uses "type" but "text" (value to type) is missing`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
