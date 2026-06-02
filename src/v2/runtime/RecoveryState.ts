import type { FailureEvidence } from './FailureClassifier';
import type { V2ToolResult } from './types';

export type PlannerRecoveryStateKind =
  | 'wrong_target_type'
  | 'same_action_loop'
  | 'zero_result_read_loop'
  | 'unselected_ref'
  | 'invalid_output_repeat'
  | 'max_step_risk';

export interface PlannerRecoveryState {
  state: PlannerRecoveryStateKind;
  severity: 'info' | 'warning' | 'critical';
  blockedAction?: {
    tool: string;
    ref?: string;
  };
  nextMechanisms: string[];
  signals: string[];
}

export interface RecoveryStateBuilderInput {
  lastResult?: V2ToolResult;
  failures?: FailureEvidence[];
  uncertaintySignals?: string[];
}

export class RecoveryStateBuilder {
  build(input: RecoveryStateBuilderInput): PlannerRecoveryState | undefined {
    const signals = collectRecoverySignals(input);
    const wrongTarget = buildWrongTargetRecovery(input.lastResult, signals);
    if (wrongTarget) return wrongTarget;

    if (signals.some(signal => signal.startsWith('repeated_no_progress_transition:'))) {
      return {
        state: 'same_action_loop',
        severity: 'warning',
        blockedAction: blockedActionFromSignal(signals.find(signal => signal.startsWith('repeated_no_progress_transition:'))),
        nextMechanisms: ['avoid_repeating_blocked_action', 'choose_alternative_ref', 'expand_or_reobserve'],
        signals,
      };
    }

    if (signals.some(signal => signal.startsWith('repeated_value_preview:search_page:'))) {
      return {
        state: 'zero_result_read_loop',
        severity: 'warning',
        blockedAction: blockedActionFromSignal(signals.find(signal => signal.startsWith('repeated_value_preview:search_page:'))),
        nextMechanisms: ['try_different_evidence_action', 'inspect_region_or_scroll', 'stop_if_dead_end_evidence_is_sufficient'],
        signals,
      };
    }

    if (signals.some(signal => signal.includes('unselected_ref'))) {
      return {
        state: 'unselected_ref',
        severity: 'warning',
        nextMechanisms: ['expand_scope_or_reobserve', 'use_selected_ref_only'],
        signals,
      };
    }

    if (signals.some(signal => signal.includes('invalid_output_repeat'))) {
      return {
        state: 'invalid_output_repeat',
        severity: 'critical',
        nextMechanisms: ['stop_dead_end_with_validation_evidence'],
        signals,
      };
    }

    return undefined;
  }
}

function buildWrongTargetRecovery(
  lastResult: V2ToolResult | undefined,
  signals: string[],
): PlannerRecoveryState | undefined {
  const code = lastResult?.error?.code;
  if (code !== 'target_not_editable' && code !== 'target_not_clickable') {
    return undefined;
  }

  return {
    state: 'wrong_target_type',
    severity: 'warning',
    blockedAction: {
      tool: lastResult?.kind ?? 'unknown',
      ref: lastResult?.targetRef,
    },
    nextMechanisms: code === 'target_not_editable'
      ? ['choose_typeable_ref', 'click_launcher_then_type', 'expand_or_reobserve']
      : ['choose_clickable_ref', 'expand_or_reobserve'],
    signals,
  };
}

function collectRecoverySignals(input: RecoveryStateBuilderInput): string[] {
  const signals: string[] = [];
  if (input.lastResult?.error?.code) {
    signals.push(`last_error:${input.lastResult.error.code}`);
  }
  for (const failure of input.failures ?? []) {
    signals.push(`failure:${failure.kind}`);
  }
  signals.push(...(input.uncertaintySignals ?? []));
  return [...new Set(signals)];
}

function blockedActionFromSignal(signal: string | undefined): PlannerRecoveryState['blockedAction'] {
  if (!signal) return undefined;
  const parts = signal.split(':');
  return {
    tool: parts[1] || 'unknown',
    ref: parts[2] && parts[2] !== 'global' ? parts[2] : undefined,
  };
}
