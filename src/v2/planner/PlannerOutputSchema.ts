import type {
  PlannerConfidence,
  PlannerEscalation,
  PlannerOutput,
  PlannerOutputStep,
  PlannerOutputTool,
  PlannerOutputValidationResult,
} from './types';
import { isSupportedNavigationUrl, NAVIGATION_URL_POLICY_MESSAGE } from '../runtime/navigationPolicy';
import type { PlannerActionSurface } from './workingSetTypes';

export interface PlannerOutputValidationContext {
  allowedRefs?: readonly string[];
  regionRefs?: Readonly<Record<string, string>>;
  actionSurface?: PlannerActionSurface;
  mode?: 'normal' | 'finalization';
  actionCompatibilityScope?: 'all_steps' | 'first_step';
}

const VALID_TOOLS = new Set<PlannerOutputTool>([
  'click',
  'type',
  'navigate',
  'scroll',
  'wait',
  'press',
  'get',
  'close',
  'select',
  'search_page',
  'find_elements',
  'count_elements',
  'inspect_region',
]);
const VALID_CONFIDENCE = new Set<PlannerConfidence>(['high', 'medium', 'low']);
const VALID_ESCALATION = new Set<PlannerEscalation>(['user_needed', 'captcha', 'dead_end']);
const VALID_PRESS_KEYS = new Set(['Enter', 'Escape', 'Tab', 'ArrowDown', 'ArrowUp']);
const REF_REQUIRED_TOOLS = new Set<PlannerOutputTool>(['click', 'type', 'get', 'close', 'select', 'inspect_region']);
const FORBIDDEN_FIELDS = new Set([
  'sel',
  'selector',
  'selectors',
  'css',
  'xpath',
  'coordinates',
  'x',
  'y',
  'backendNodeId',
  'cdp',
  'playwright',
]);
const FORBIDDEN_SCRIPT_FIELDS = new Set(['script', 'javascript', 'js']);
const REF_ALIAS_FIELDS = new Set(['sel', 'selector']);

export class PlannerOutputSchema {
  validate(raw: unknown, context: PlannerOutputValidationContext = {}): PlannerOutputValidationResult {
    if (!isRecord(raw)) {
      return { ok: false, errors: ['Planner output must be an object'] };
    }

    const errors: string[] = [];
    const hasPlan = Array.isArray(raw.plan) && raw.plan.length > 0;
    const hasDone = raw.done === true;
    const hasEscalate = raw.escalate !== undefined;

    if (!hasPlan && !hasDone && !hasEscalate) {
      errors.push('Planner output must include plan, done, or escalate');
    }

    if (hasDone && typeof raw.val !== 'string') {
      errors.push('done output requires "val"');
    }

    if (raw.confidence !== undefined && !isConfidence(raw.confidence)) {
      errors.push('"confidence" must be high, medium, or low');
    }

    if (raw.escalate !== undefined && !isEscalation(raw.escalate)) {
      errors.push('"escalate" must be user_needed, captcha, or dead_end');
    }

    if (context.mode === 'finalization' && hasPlan) {
      errors.push('Finalization mode cannot return plan');
    }

    if (hasPlan) {
      if (raw.confidence === undefined) {
        errors.push('plan output requires "confidence"');
      }
      const normalizedPlan = validatePlanSteps(raw.plan as unknown[], errors, context);
      if (errors.length === 0) {
        return {
          ok: true,
          value: {
            ...raw,
            plan: normalizedPlan,
          } as PlannerOutput,
        };
      }
    }

    if (errors.length > 0) {
      return { ok: false, errors };
    }

    return { ok: true, value: raw as PlannerOutput };
  }
}

function validatePlanSteps(
  steps: unknown[],
  errors: string[],
  context: PlannerOutputValidationContext,
): PlannerOutputStep[] {
  const normalizedSteps: PlannerOutputStep[] = [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const stepNumber = index + 1;

    if (!isRecord(step)) {
      errors.push(`Step ${stepNumber} must be an object`);
      continue;
    }

    const normalizedStep = normalizePlannerStep(step, context);
    validateForbiddenFields(step, normalizedStep, stepNumber, errors);

    if (typeof normalizedStep.tool !== 'string' || !VALID_TOOLS.has(normalizedStep.tool as PlannerOutputTool)) {
      errors.push(`Step ${stepNumber} has unknown tool "${String(normalizedStep.tool)}"`);
      continue;
    }

    const tool = normalizedStep.tool as PlannerOutputTool;
    const candidateStep = normalizedStep as unknown as Partial<PlannerOutputStep>;
    validateRequiredFields(tool, candidateStep, stepNumber, errors, context);
    normalizedSteps.push(normalizedStep as unknown as PlannerOutputStep);
  }

  return normalizedSteps;
}

function validateForbiddenFields(
  originalStep: Record<string, unknown>,
  normalizedStep: Record<string, unknown>,
  stepNumber: number,
  errors: string[],
): void {
  for (const field of Object.keys(originalStep)) {
    if (REF_ALIAS_FIELDS.has(field) && !(field in normalizedStep) && normalizedStep.ref !== undefined) {
      continue;
    }
    if (FORBIDDEN_FIELDS.has(field)) {
      errors.push(`Step ${stepNumber} selector fields are not valid in v2 planner output`);
    }
    if (FORBIDDEN_SCRIPT_FIELDS.has(field)) {
      errors.push(`Step ${stepNumber} script fields are not valid in v2 planner output`);
    }
  }
}

function normalizePlannerStep(
  step: Record<string, unknown>,
  context: PlannerOutputValidationContext,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...step };
  if (typeof normalized.ref === 'string') {
    normalized.ref = normalizeTargetRef(normalized.ref, normalized.tool, context) ?? normalized.ref;
  }

  for (const field of REF_ALIAS_FIELDS) {
    if (normalized.ref !== undefined) {
      break;
    }
    const candidate = normalized[field];
    if (typeof candidate !== 'string') {
      continue;
    }
    const targetRef = normalizeTargetRef(candidate, normalized.tool, context);
    if (targetRef !== undefined) {
      normalized.ref = targetRef;
      delete normalized[field];
    }
  }

  // Normalize 'option' → 'value' for select steps only
  if (normalized.tool === 'select' && normalized.value === undefined && typeof normalized.option === 'string') {
    normalized.value = normalized.option;
    delete normalized.option;
  }

  // Defense-in-depth: recover 'val' → 'value' for select steps.
  // The parser's normalize() maps top-level 'value' → 'val' for done responses,
  // but plan step 'value' (select dropdown) must NOT be mapped. If it was, recover here.
  if (normalized.tool === 'select' && normalized.value === undefined && typeof normalized.val === 'string') {
    normalized.value = normalized.val;
    delete normalized.val;
  }

  return normalized;
}

function validateRequiredFields(
  tool: PlannerOutputTool,
  step: Partial<PlannerOutputStep>,
  stepNumber: number,
  errors: string[],
  context: PlannerOutputValidationContext,
): void {
  if (REF_REQUIRED_TOOLS.has(tool) && !isNonEmptyString(step.ref)) {
    errors.push(`Step ${stepNumber} ${tool} requires "ref"`);
  }

  if (
    REF_REQUIRED_TOOLS.has(tool)
    && isNonEmptyString(step.ref)
    && context.allowedRefs !== undefined
    && !isAllowedRef(step.ref, context)
  ) {
    errors.push(`Step ${stepNumber} ref "${step.ref}" is not present in selected planner refs`);
  }

  if (tool === 'type' && !isNonEmptyString(step.text)) {
    errors.push(`Step ${stepNumber} type requires "text"`);
  }

  validateActionCompatibility(tool, step, stepNumber, errors, context);

  if (tool === 'navigate' && !isNonEmptyString(step.url)) {
    errors.push(`Step ${stepNumber} navigate requires "url"`);
  }

  if (tool === 'navigate' && isNonEmptyString(step.url) && !isSupportedNavigationUrl(step.url)) {
    errors.push(`Step ${stepNumber} ${NAVIGATION_URL_POLICY_MESSAGE}`);
  }

  if (tool === 'select' && !isNonEmptyString(step.value)) {
    errors.push(`Step ${stepNumber} select requires "value"`);
  }

  if (tool === 'search_page' && !isNonEmptyString(step.pattern)) {
    errors.push(`Step ${stepNumber} search_page requires "pattern"`);
  }

  if (tool === 'press' && !VALID_PRESS_KEYS.has(String(step.key))) {
    errors.push(`Step ${stepNumber} press key must be Enter, Escape, Tab, ArrowDown, or ArrowUp`);
  }

  if (step.direction !== undefined && step.direction !== 'down' && step.direction !== 'up') {
    errors.push(`Step ${stepNumber} direction must be down or up`);
  }

  if (step.timeout !== undefined && typeof step.timeout !== 'number') {
    errors.push(`Step ${stepNumber} timeout must be a number`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isConfidence(value: unknown): value is PlannerConfidence {
  return value === 'high' || value === 'medium' || value === 'low';
}

function isEscalation(value: unknown): value is PlannerEscalation {
  return value === 'user_needed' || value === 'captcha' || value === 'dead_end';
}

function isAllowedRef(value: string, context: PlannerOutputValidationContext): boolean {
  return context.allowedRefs?.includes(value) === true;
}

function validateActionCompatibility(
  tool: PlannerOutputTool,
  step: Partial<PlannerOutputStep>,
  stepNumber: number,
  errors: string[],
  context: PlannerOutputValidationContext,
): void {
  if (context.actionCompatibilityScope === 'first_step' && stepNumber > 1) {
    return;
  }

  const ref = step.ref;
  const surface = context.actionSurface;
  if (!surface || !isNonEmptyString(ref) || surface.ambiguousRefs.includes(ref)) {
    return;
  }

  if ((tool === 'click' || tool === 'close') && !surface.clickableRefs.includes(ref)) {
    errors.push(`Step ${stepNumber} ref "${ref}" is not compatible with tool "${tool}"`);
  }

  if (tool === 'type' && !surface.typeableRefs.includes(ref)) {
    errors.push(`Step ${stepNumber} ref "${ref}" is not compatible with tool "type"`);
  }

  if (tool === 'select' && !surface.selectableRefs.includes(ref)) {
    errors.push(`Step ${stepNumber} ref "${ref}" is not compatible with tool "select"`);
  }
}

function normalizeTargetRef(
  value: string,
  tool: unknown,
  context: PlannerOutputValidationContext,
): string | undefined {
  if (tool === 'inspect_region' && context.regionRefs?.[value]) {
    return context.regionRefs[value];
  }
  if (isAllowedRef(value, context) || isBrowseGentRefToken(value)) {
    return value;
  }
  return undefined;
}

function isBrowseGentRefToken(value: string): boolean {
  return /^v2ref_\d+$/.test(value);
}
