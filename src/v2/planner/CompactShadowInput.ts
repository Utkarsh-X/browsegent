import type { CompactPlannerView } from './CompactPlannerView';
import type { PlannerOutput } from './types';

export interface CompactShadowPlannerInput {
  version: 'compact_shadow_input.v1';
  episodeId?: string;
  goal: string;
  url?: string;
  mode?: string;
  observationEpoch?: CompactPlannerView['observationEpoch'];
  lastResult?: CompactPlannerView['lastResult'];
  recovery?: CompactPlannerView['recovery'];
  uncertainty?: CompactPlannerView['uncertainty'];
  validationFeedback?: {
    previousErrors: string[];
    previousOutput: string;
    instruction: string;
  };
  actions: Array<{ index: string; role?: string; label: string; tools: string[] }>;
  reads: Array<{ index: string; text: string; tools: ['get', 'inspect_region'] }>;
}

export interface CompactShadowInputBuildResult {
  input: CompactShadowPlannerInput;
  indexToRef: Record<string, string>;
  refToIndex: Record<string, string>;
  eligibility: {
    eligible: boolean;
    productionFirstRef?: string;
    missingProductionFirstRef?: string;
    productionPlanRefs: string[];
    missingProductionPlanRefs: string[];
    productionFirstStepKind: 'ref_action' | 'no_ref_action' | 'termination' | 'empty';
  };
}

function mapTools(tools: string[]): string[] {
  const toolMap: Record<string, string> = {
    clickable: 'click',
    typeable: 'type',
    selectable: 'select',
    readable: 'get',
  };
  const mapped = new Set<string>();
  for (const tool of tools) {
    if (toolMap[tool]) {
      mapped.add(toolMap[tool]);
    }
  }
  return Array.from(mapped).sort();
}

export function buildCompactShadowInput(
  view: CompactPlannerView,
  productionOutput?: PlannerOutput,
): CompactShadowInputBuildResult {
  const actionsInput: Array<{ index: string; role?: string; label: string; tools: string[] }> = [];
  const indexToRef: Record<string, string> = {};
  const refToIndex: Record<string, string> = {};
  const actionRefs = new Set<string>();

  // 1. Process Actions
  let actionIdx = 1;
  for (const action of view.actions || []) {
    const refId = action.refId;
    const mappedTools = mapTools(action.tools);
    const hasActionTool = mappedTools.some(tool => tool === 'click' || tool === 'type' || tool === 'select');
    if (!hasActionTool) {
      continue;
    }
    actionRefs.add(refId);
    const index = `a${actionIdx++}`;

    actionsInput.push({
      index,
      role: action.role,
      label: action.label,
      tools: mappedTools,
    });

    indexToRef[index] = refId;
    refToIndex[refId] = index;
  }

  // 2. Process Reads (excluding shared action refs)
  const readsInput: Array<{ index: string; text: string; tools: ['get', 'inspect_region'] }> = [];
  let readIdx = 1;
  for (const read of view.reads || []) {
    const refId = read.refId;
    if (actionRefs.has(refId)) {
      continue; // Keep action index and do not duplicate in reads
    }
    const index = `r${readIdx++}`;

    readsInput.push({
      index,
      text: read.text,
      tools: ['get', 'inspect_region'],
    });

    indexToRef[index] = refId;
    refToIndex[refId] = index;
  }

  // 3. Construct input
  const input: CompactShadowPlannerInput = {
    version: 'compact_shadow_input.v1',
    episodeId: view.episodeId,
    goal: view.goal,
    url: view.url,
    mode: view.mode,
    observationEpoch: view.observationEpoch,
    lastResult: view.lastResult,
    recovery: view.recovery,
    uncertainty: view.uncertainty,
    actions: actionsInput,
    reads: readsInput,
  };

  // 4. Eligibility Check
  const productionPlanRefs: string[] = [];
  const missingProductionPlanRefs: string[] = [];
  let productionFirstRef: string | undefined = undefined;
  let missingProductionFirstRef: string | undefined = undefined;

  const plan = productionOutput?.plan;
  const isDoneOrEscalate = productionOutput?.done === true || productionOutput?.escalate !== undefined;
  let eligible = false;

  let productionFirstStepKind: 'ref_action' | 'no_ref_action' | 'termination' | 'empty' = 'empty';

  if (isDoneOrEscalate) {
    eligible = true;
    productionFirstStepKind = 'termination';
  } else if (plan && plan.length > 0) {
    const firstRef = plan[0].ref;
    if (firstRef !== undefined && firstRef !== null) {
      productionFirstStepKind = 'ref_action';
    } else {
      productionFirstStepKind = 'no_ref_action';
    }
  }

  if (plan && plan.length > 0) {
    // Collect refs and check missing
    for (const step of plan) {
      const ref = step.ref;
      if (ref !== undefined && ref !== null) {
        if (!productionPlanRefs.includes(ref)) {
          productionPlanRefs.push(ref);
        }
        if (refToIndex[ref] === undefined) {
          if (!missingProductionPlanRefs.includes(ref)) {
            missingProductionPlanRefs.push(ref);
          }
        }
      }
    }

    // Check first decision ref eligibility
    const firstRef = plan[0].ref;
    if (firstRef !== undefined && firstRef !== null) {
      if (refToIndex[firstRef] !== undefined) {
        productionFirstRef = firstRef;
        if (!isDoneOrEscalate) {
          eligible = true;
        }
      } else {
        missingProductionFirstRef = firstRef;
        if (!isDoneOrEscalate) {
          eligible = false;
        }
      }
    } else {
      if (!isDoneOrEscalate) {
        eligible = true;
      }
    }
  }

  return {
    input,
    indexToRef,
    refToIndex,
    eligibility: {
      eligible,
      productionFirstRef,
      missingProductionFirstRef,
      productionPlanRefs,
      missingProductionPlanRefs,
      productionFirstStepKind,
    },
  };
}
