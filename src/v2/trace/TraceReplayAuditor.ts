import { readFile } from 'node:fs/promises';

export interface TraceReplayAuditInput {
  tracePath: string;
  expectedPlannerCalls?: number;
  expectedToolExecutions?: number;
  requireAgentMode?: boolean;
}

export interface TraceReplayAuditResult {
  ok: boolean;
  plannerInputCount: number;
  plannerOutputCount: number;
  runtimeStepCount: number;
  failedStepCount: number;
  observationCount: number;
  mutationWithoutEvidenceCount: number;
  errors: string[];
}

interface TraceReplayJson {
  runtimeMode?: string;
  artifacts?: {
    trace?: { kind?: string };
    observations?: Array<{ kind?: string }>;
    planner?: Array<{ kind?: string }>;
  };
  steps?: Array<{
    kind?: string;
    status?: string;
    afterObservationId?: string;
    result?: unknown;
  }>;
}

const MUTATING_STEP_KINDS = new Set(['click', 'type', 'scroll', 'wait']);

export async function auditTraceReplay(input: TraceReplayAuditInput): Promise<TraceReplayAuditResult> {
  try {
    const trace = JSON.parse(await readFile(input.tracePath, 'utf8')) as TraceReplayJson;
    return auditTraceReplayJson(trace, input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emptyAuditResult([`trace_read_failed:${message}`]);
  }
}

export function auditTraceReplayJson(
  trace: TraceReplayJson,
  input: Omit<TraceReplayAuditInput, 'tracePath'> = {},
): TraceReplayAuditResult {
  const plannerArtifacts = Array.isArray(trace.artifacts?.planner) ? trace.artifacts.planner : [];
  const plannerInputCount = plannerArtifacts.filter(artifact => artifact.kind === 'planner_input').length;
  const plannerOutputCount = plannerArtifacts.filter(artifact => artifact.kind === 'planner_output').length;
  const observationCount = Array.isArray(trace.artifacts?.observations) ? trace.artifacts.observations.length : 0;
  const runtimeSteps = Array.isArray(trace.steps) ? trace.steps : [];
  const failedStepCount = runtimeSteps.filter(step => step.status !== 'completed').length;
  const mutationWithoutEvidenceCount = runtimeSteps.filter(step => {
    if (!MUTATING_STEP_KINDS.has(step.kind ?? '')) {
      return false;
    }
    return !step.afterObservationId || !hasEvidence(step.result);
  }).length;
  const errors = [
    input.requireAgentMode && trace.runtimeMode !== 'agent' ? 'trace_runtime_mode_not_agent' : undefined,
    trace.artifacts?.trace?.kind === 'trace' ? undefined : 'missing_trace_artifact',
    observationCount > 0 ? undefined : 'missing_observation_artifacts',
    input.expectedPlannerCalls !== undefined && plannerInputCount < input.expectedPlannerCalls
      ? 'missing_planner_input_artifacts'
      : undefined,
    input.expectedPlannerCalls !== undefined && plannerOutputCount < input.expectedPlannerCalls
      ? 'missing_planner_output_artifacts'
      : undefined,
    input.expectedToolExecutions !== undefined && runtimeSteps.length < input.expectedToolExecutions
      ? 'missing_runtime_steps'
      : undefined,
    failedStepCount === 0 ? undefined : 'failed_runtime_steps',
    mutationWithoutEvidenceCount === 0 ? undefined : 'missing_mutation_evidence',
  ].filter((error): error is string => typeof error === 'string');

  return {
    ok: errors.length === 0,
    plannerInputCount,
    plannerOutputCount,
    runtimeStepCount: runtimeSteps.length,
    failedStepCount,
    observationCount,
    mutationWithoutEvidenceCount,
    errors,
  };
}

function emptyAuditResult(errors: string[]): TraceReplayAuditResult {
  return {
    ok: false,
    plannerInputCount: 0,
    plannerOutputCount: 0,
    runtimeStepCount: 0,
    failedStepCount: 0,
    observationCount: 0,
    mutationWithoutEvidenceCount: 0,
    errors,
  };
}

function hasEvidence(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && 'evidence' in value && (value as { evidence?: unknown }).evidence);
}
