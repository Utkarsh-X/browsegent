import type { FailureEvidence } from './FailureClassifier';
import type { V2ToolResult } from './types';

export type PlannerRecoveryStateKind =
  | 'wrong_target_type'
  | 'persistent_target_blocker'
  | 'same_action_loop'
  | 'repeated_read_same_value'
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
    const persistentBlocker = buildPersistentBlockerRecovery(input, signals);
    if (persistentBlocker) return persistentBlocker;

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

    if (signals.some(signal => signal.startsWith('repeated_no_progress_kind:'))) {
      return {
        state: 'same_action_loop',
        severity: 'warning',
        blockedAction: blockedActionFromSignal(signals.find(signal => signal.startsWith('repeated_no_progress_kind:'))),
        nextMechanisms: ['avoid_repeating_blocked_action', 'choose_alternative_ref', 'expand_or_reobserve'],
        signals,
      };
    }

    if (signals.some(signal => signal.startsWith('repeated_no_progress_target:'))) {
      return {
        state: 'same_action_loop',
        severity: 'warning',
        nextMechanisms: ['avoid_repeating_blocked_action', 'choose_alternative_ref', 'expand_or_reobserve'],
        signals,
      };
    }

    if (signals.some(signal => signal.startsWith('repeated_value_preview:get:') || signal.startsWith('repeated_value_preview:inspect_region:'))) {
      return {
        state: 'repeated_read_same_value',
        severity: 'warning',
        blockedAction: blockedActionFromSignal(signals.find(signal =>
          signal.startsWith('repeated_value_preview:get:') || signal.startsWith('repeated_value_preview:inspect_region:')
        )),
        nextMechanisms: ['finalize_with_collected_evidence', 'try_different_ref', 'stop_if_dead_end_evidence_is_sufficient'],
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

function buildPersistentBlockerRecovery(
  input: RecoveryStateBuilderInput,
  signals: string[],
): PlannerRecoveryState | undefined {
  if (input.lastResult?.error?.code !== 'target_blocked') {
    return undefined;
  }

  const blockedFailures = (input.failures ?? []).filter(failure =>
    failure.kind === 'target_blocked'
    && Boolean(failure.targetRef)
    && typeof failure.generationId === 'number'
    && typeof failure.url === 'string'
    && blockerFingerprint(failure) !== undefined,
  );
  const currentFailure = [...blockedFailures].reverse().find(failure =>
    failure.targetRef === input.lastResult?.targetRef,
  );
  if (!currentFailure) return undefined;

  const sameEpoch = blockedFailures.filter(failure =>
    failure.generationId === currentFailure.generationId
    && failure.url === currentFailure.url,
  );
  const groups = new Map<string, Set<string>>();
  for (const failure of sameEpoch) {
    const fingerprint = blockerFingerprint(failure);
    if (!fingerprint || !failure.targetRef) continue;
    const refs = groups.get(fingerprint) ?? new Set<string>();
    refs.add(failure.targetRef);
    groups.set(fingerprint, refs);
  }

  const matchingGroup = [...groups.values()].find(refs => refs.size >= 2);
  if (!matchingGroup) return undefined;

  return {
    state: 'persistent_target_blocker',
    severity: 'warning',
    blockedAction: {
      tool: input.lastResult.kind,
      ref: input.lastResult.targetRef,
    },
    nextMechanisms: [
      'avoid_repeating_blocked_action',
      'reobserve_current_surface',
      'inspect_region_or_scroll',
      'find_dismiss_or_close_control',
      'choose_unblocked_alternative',
    ],
    signals: [
      ...signals,
      `persistent_blocker:${matchingGroup.size}`,
    ],
  };
}

function blockerFingerprint(failure: FailureEvidence): string | undefined {
  const diagnostics = failure.diagnostics;
  const description = diagnostics?.blockerDescription;
  if (typeof description !== 'string' || description.trim().length === 0) {
    return undefined;
  }

  return [
    normalizeBlockerPart(description),
    normalizeBlockerPart(diagnostics?.blockerTagName),
    normalizeBlockerPart(diagnostics?.hitTestOutcome),
    String(diagnostics?.blockerIsFixedOrSticky === true),
    String(diagnostics?.blockerIsNativeDialog === true),
    String(diagnostics?.blockerIsTransparent === true),
    String(diagnostics?.blockerCoversFullViewport === true),
  ].join('|');
}

function normalizeBlockerPart(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 160)
    : '';
}

function buildWrongTargetRecovery(
  lastResult: V2ToolResult | undefined,
  signals: string[],
): PlannerRecoveryState | undefined {
  const code = lastResult?.error?.code;
  const WRONG_TARGET_CODES = new Set([
    'target_not_editable',
    'target_not_clickable',
    'target_blocked',
    'ambiguous_ref_resolution',
    'low_confidence_ref',
    'unselected_ref',
  ]);

  if (!code || !WRONG_TARGET_CODES.has(code)) {
    return undefined;
  }

  return {
    state: 'wrong_target_type',
    severity: 'warning',
    blockedAction: {
      tool: lastResult?.kind ?? 'unknown',
      ref: lastResult?.targetRef,
    },
    nextMechanisms: mechanismsForErrorCode(code),
    signals,
  };
}

function mechanismsForErrorCode(code: string): string[] {
  if (code === 'target_not_editable') {
    return ['choose_typeable_ref', 'click_launcher_then_type', 'expand_or_reobserve'];
  }
  if (code === 'target_not_clickable' || code === 'target_blocked' || code === 'low_confidence_ref') {
    return ['avoid_repeating_blocked_action', 'choose_alternative_ref', 'use_readable_evidence_if_goal_is_answerable', 'expand_or_reobserve'];
  }
  if (code === 'ambiguous_ref_resolution') {
    return ['choose_less_ambiguous_ref', 'inspect_region_or_scope', 'use_current_focus_or_overlay', 'expand_or_reobserve'];
  }
  return ['choose_alternative_ref', 'expand_or_reobserve'];
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
  if (signal.startsWith('repeated_no_progress_kind:')) {
    return { tool: parts[1] || 'unknown' };
  }
  return {
    tool: parts[1] || 'unknown',
    ref: parts[2] && parts[2] !== 'global' ? parts[2] : undefined,
  };
}
