import type { PlannerOutput, PlannerOutputStep } from './types';
import type { CompactShadowPlannerResult } from './CompactShadowPlanner';

export type CompactShadowAgreement =
  | 'exact_first_action'
  | 'same_tool_different_ref'
  | 'different_tool'
  | 'both_done'
  | 'both_escalate'
  | 'production_done_shadow_action'
  | 'production_action_shadow_done'
  | 'production_escalate_shadow_action'
  | 'production_action_shadow_escalate'
  | 'shadow_invalid'
  | 'shadow_provider_error'
  | 'episode_ineligible';

export interface CompactShadowComparison {
  agreement: CompactShadowAgreement;
  productionFirstStep?: PlannerOutputStep;
  shadowFirstStep?: PlannerOutputStep;
  productionFirstStepExecution: 'succeeded' | 'failed' | 'not_found' | 'not_applicable';
  productionOutputKind: 'plan' | 'done' | 'escalate' | 'empty';
  shadowOutputKind: 'plan' | 'done' | 'escalate' | 'invalid' | 'provider_error';
  countsTowardSuccessfulProductionAgreement: boolean;
}

export function compareCompactShadow(
  productionOutput: PlannerOutput,
  shadowResult: CompactShadowPlannerResult,
  productionFirstStepExecution: 'succeeded' | 'failed' | 'not_found' | 'not_applicable',
  eligible: boolean = true,
): CompactShadowComparison {
  // Classify productionOutputKind
  let productionOutputKind: 'plan' | 'done' | 'escalate' | 'empty' = 'empty';
  if (productionOutput.done === true) {
    productionOutputKind = 'done';
  } else if (productionOutput.escalate !== undefined) {
    productionOutputKind = 'escalate';
  } else if (productionOutput.plan && productionOutput.plan.length > 0) {
    productionOutputKind = 'plan';
  }

  // Classify shadowOutputKind
  let shadowOutputKind: 'plan' | 'done' | 'escalate' | 'invalid' | 'provider_error';
  if (shadowResult.status === 'provider_error') {
    shadowOutputKind = 'provider_error';
  } else if (shadowResult.status === 'invalid_output') {
    shadowOutputKind = 'invalid';
  } else {
    // status is 'valid'
    const shadowOutput = shadowResult.output;
    if (shadowOutput.done === true) {
      shadowOutputKind = 'done';
    } else if (shadowOutput.escalate !== undefined) {
      shadowOutputKind = 'escalate';
    } else if (shadowOutput.plan && shadowOutput.plan.length > 0) {
      shadowOutputKind = 'plan';
    } else {
      shadowOutputKind = 'invalid';
    }
  }

  // Retrieve first steps if present
  const productionFirstStep =
    productionOutput.plan && productionOutput.plan.length > 0
      ? productionOutput.plan[0]
      : undefined;

  const shadowFirstStep =
    shadowResult.status === 'valid' &&
    shadowResult.output.plan &&
    shadowResult.output.plan.length > 0
      ? shadowResult.output.plan[0]
      : undefined;

  // Determine agreement
  let agreement: CompactShadowAgreement;

  if (!eligible) {
    agreement = 'episode_ineligible';
  } else if (shadowResult.status === 'provider_error') {
    agreement = 'shadow_provider_error';
  } else if (shadowResult.status === 'invalid_output') {
    agreement = 'shadow_invalid';
  } else {
    // Both are eligible and shadow result is valid
    if (productionOutputKind === 'done' && shadowOutputKind === 'done') {
      agreement = 'both_done';
    } else if (productionOutputKind === 'escalate' && shadowOutputKind === 'escalate') {
      agreement = 'both_escalate';
    } else if (productionOutputKind === 'done' && shadowOutputKind === 'plan') {
      agreement = 'production_done_shadow_action';
    } else if (productionOutputKind === 'plan' && shadowOutputKind === 'done') {
      agreement = 'production_action_shadow_done';
    } else if (productionOutputKind === 'escalate' && shadowOutputKind === 'plan') {
      agreement = 'production_escalate_shadow_action';
    } else if (productionOutputKind === 'plan' && shadowOutputKind === 'escalate') {
      agreement = 'production_action_shadow_escalate';
    } else if (productionOutputKind === 'plan' && shadowOutputKind === 'plan') {
      const p0 = productionFirstStep!;
      const s0 = shadowFirstStep!;
      if (areStepsEquivalent(p0, s0)) {
        agreement = 'exact_first_action';
      } else if (p0.tool === s0.tool && p0.ref !== s0.ref) {
        agreement = 'same_tool_different_ref';
      } else {
        agreement = 'different_tool';
      }
    } else {
      // Fallback for other combinations (e.g. done vs escalate, empty vs anything, etc.)
      agreement = 'different_tool';
    }
  }

  // Counts toward successful production agreement
  const countsTowardSuccessfulProductionAgreement =
    productionFirstStepExecution === 'succeeded' && agreement === 'exact_first_action';

  return {
    agreement,
    productionFirstStep,
    shadowFirstStep,
    productionFirstStepExecution,
    productionOutputKind,
    shadowOutputKind,
    countsTowardSuccessfulProductionAgreement,
  };
}

function areStepsEquivalent(p: PlannerOutputStep, s: PlannerOutputStep): boolean {
  if (p.tool !== s.tool) return false;
  if (p.ref !== s.ref) return false;

  if (p.tool === 'navigate') {
    return p.url === s.url;
  }
  if (p.tool === 'press') {
    return p.key === s.key;
  }
  if (p.tool === 'scroll') {
    return p.direction === s.direction;
  }
  if (p.tool === 'wait') {
    return p.pattern === s.pattern && p.timeout === s.timeout;
  }
  if (p.tool === 'search_page') {
    return p.pattern === s.pattern;
  }
  if (p.tool === 'type') {
    return p.text === s.text;
  }
  if (p.tool === 'select') {
    return p.value === s.value;
  }
  return true;
}
