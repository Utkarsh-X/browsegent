import type {
  PlannerConfidence,
  PlannerEscalation,
  PlannerOutput,
  PlannerOutputStep,
  PlannerOutputTool,
  PlannerOutputValidationResult,
} from './types';

const VALID_TOOLS = new Set<PlannerOutputTool>([
  'click',
  'type',
  'scroll',
  'wait',
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

export class PlannerOutputSchema {
  validate(raw: unknown): PlannerOutputValidationResult {
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

    if (hasPlan) {
      if (raw.confidence === undefined) {
        errors.push('plan output requires "confidence"');
      }
      validatePlanSteps(raw.plan as unknown[], errors);
    }

    if (errors.length > 0) {
      return { ok: false, errors };
    }

    return { ok: true, value: raw as PlannerOutput };
  }
}

function validatePlanSteps(steps: unknown[], errors: string[]): void {
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const stepNumber = index + 1;

    if (!isRecord(step)) {
      errors.push(`Step ${stepNumber} must be an object`);
      continue;
    }

    validateForbiddenFields(step, stepNumber, errors);

    if (typeof step.tool !== 'string' || !VALID_TOOLS.has(step.tool as PlannerOutputTool)) {
      errors.push(`Step ${stepNumber} has unknown tool "${String(step.tool)}"`);
      continue;
    }

    const tool = step.tool as PlannerOutputTool;
    validateRequiredFields(tool, step as Partial<PlannerOutputStep>, stepNumber, errors);
  }
}

function validateForbiddenFields(step: Record<string, unknown>, stepNumber: number, errors: string[]): void {
  for (const field of Object.keys(step)) {
    if (FORBIDDEN_FIELDS.has(field)) {
      errors.push(`Step ${stepNumber} selector fields are not valid in v2 planner output`);
    }
    if (FORBIDDEN_SCRIPT_FIELDS.has(field)) {
      errors.push(`Step ${stepNumber} script fields are not valid in v2 planner output`);
    }
  }
}

function validateRequiredFields(
  tool: PlannerOutputTool,
  step: Partial<PlannerOutputStep>,
  stepNumber: number,
  errors: string[],
): void {
  if (REF_REQUIRED_TOOLS.has(tool) && !isNonEmptyString(step.ref)) {
    errors.push(`Step ${stepNumber} ${tool} requires "ref"`);
  }

  if (tool === 'type' && !isNonEmptyString(step.text)) {
    errors.push(`Step ${stepNumber} type requires "text"`);
  }

  if (tool === 'select' && !isNonEmptyString(step.value)) {
    errors.push(`Step ${stepNumber} select requires "value"`);
  }

  if (tool === 'search_page' && !isNonEmptyString(step.pattern)) {
    errors.push(`Step ${stepNumber} search_page requires "pattern"`);
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
