// ── validator.ts — Semantic Correctness ─────────────────────────────────────
// "Is this output actually usable?" — not just "did it parse?"
// Returns specific error messages for targeted retry feedback.

import { ACTION_CATALOG, getRequiredExternalFields, getValidActionKinds } from '../executor/catalog';
import type { ActionKind } from '../executor/types';

const VALID_TOOLS = new Set(getValidActionKinds());
const VALID_ESCALATIONS = new Set(['user_needed', 'captcha', 'dead_end']);
const VALID_CONFIDENCE = new Set(['high', 'medium', 'low']);

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

  if (plan['confidence'] !== undefined) {
    if (typeof plan['confidence'] !== 'string' || !VALID_CONFIDENCE.has(plan['confidence'] as string)) {
      errors.push(`"confidence" must be one of: ${[...VALID_CONFIDENCE].join(', ')}`);
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
      if (typeof step['tool'] === 'string' && !VALID_TOOLS.has(step['tool'] as ActionKind)) {
        errors.push(
          `Step ${i + 1} has unknown tool "${step['tool']}"; use: ${[...VALID_TOOLS].join(', ')}`
        );
        continue;
      }

      if (typeof step['tool'] !== 'string') continue;
      const tool = step['tool'] as ActionKind;

      for (const fieldName of getRequiredExternalFields(tool)) {
        if (step[fieldName] === undefined || step[fieldName] === null || step[fieldName] === '') {
          errors.push(`Step ${i + 1} uses "${tool}" but "${fieldName}" is missing`);
        }
      }

      const entry = ACTION_CATALOG[tool];
      for (const field of entry.fields) {
        const value = step[field.name];
        if (value === undefined) continue;
        if (field.type === 'string' && typeof value !== 'string') {
          errors.push(`Step ${i + 1} field "${field.name}" must be a string`);
        }
        if (field.type === 'number' && typeof value !== 'number') {
          errors.push(`Step ${i + 1} field "${field.name}" must be a number`);
        }
        if (field.type === 'enum') {
          if (typeof value !== 'string' || !(field.enumValues ?? []).includes(value)) {
            errors.push(`Step ${i + 1} field "${field.name}" must be one of: ${(field.enumValues ?? []).join(', ')}`);
          }
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
