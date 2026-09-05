import type { OperationalProjection } from '../brain1/projectionTypes';
import type { FailureEvidence } from './FailureClassifier';
import type { V2ToolResult } from './types';

export type PlannerRecoveryStateKind =
  | 'wrong_target_type'
  | 'persistent_target_blocker'
  | 'surface_wide_blocker'
  | 'unresponsive_surface'
  | 'navigation_oscillation'
  | 'click_no_navigation'
  | 'navigate_loop'
  | 'same_action_loop'
  | 'repeated_read_same_value'
  | 'repeated_type_same_value'
  | 'repeated_timeout_target'
  | 'zero_result_read_loop'
  | 'empty_navigation_surface'
  | 'unselected_ref'
  | 'invalid_output_repeat'
  | 'max_step_risk'
  | 'navigate_loop';

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
  projection?: OperationalProjection;
  lastResult?: V2ToolResult;
  failures?: FailureEvidence[];
  uncertaintySignals?: string[];
  /** Coverage status for the budget-risk state; only its readiness matters. */
  evidenceCoverageStatus?: string;
}

export class RecoveryStateBuilder {
  build(input: RecoveryStateBuilderInput): PlannerRecoveryState | undefined {
    const signals = collectRecoverySignals(input);
    const persistentBlocker = buildPersistentBlockerRecovery(input, signals);
    if (persistentBlocker) return persistentBlocker;

    const unresponsiveSurface = buildUnresponsiveSurfaceRecovery(input, signals);
    if (unresponsiveSurface) return unresponsiveSurface;

    const repeatedTimeoutTarget = buildRepeatedTimeoutTargetRecovery(input, signals);
    if (repeatedTimeoutTarget) return repeatedTimeoutTarget;

    const wrongTarget = buildWrongTargetRecovery(input.lastResult, signals);
    if (wrongTarget) return wrongTarget;

    const emptyNavigation = buildEmptyNavigationRecovery(input, signals);
    if (emptyNavigation) return emptyNavigation;

    const oscillation = buildNavigationOscillationRecovery(input, signals);
    if (oscillation) return oscillation;

    const clickNoNavigation = buildClickNoNavigationRecovery(input, signals);
    if (clickNoNavigation) return clickNoNavigation;

    const navigateLoop = buildNavigateLoopRecovery(input, signals);
    if (navigateLoop) return navigateLoop;

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

    if (signals.some(signal => signal.startsWith('repeated_value_preview:type:'))) {
      // The same text has been typed into the same control repeatedly: in a
      // suggestion-backed combobox the typed value is not committed until a
      // matching option is clicked (or Enter commits it). Steer to the commit
      // step instead of another identical retype.
      return {
        state: 'repeated_type_same_value',
        severity: 'warning',
        blockedAction: blockedActionFromSignal(signals.find(signal => signal.startsWith('repeated_value_preview:type:'))),
        nextMechanisms: [
          'confirm_combobox_selection',
          'click_matching_suggestion_option',
          'avoid_retyping_committed_values',
          'choose_alternative_ref',
        ],
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

    // Last in the chain: never masks a blocker state. Only fires when the run
    // is near budget exhaustion AND coverage is unfinished AND the last
    // episode ended in a rejection or block — clean-progress runs never see it.
    if (
      signals.some(signal => signal.startsWith('budget_low:'))
      && input.evidenceCoverageStatus !== undefined
      && input.evidenceCoverageStatus !== 'ready'
      && input.lastResult?.success === false
    ) {
      return {
        state: 'max_step_risk',
        severity: 'warning',
        nextMechanisms: [
          'finalize_with_collected_evidence',
          'stop_if_dead_end_evidence_is_sufficient',
          'avoid_opening_new_surfaces',
        ],
        signals,
      };
    }

    return undefined;
  }
}

function buildEmptyNavigationRecovery(
  input: RecoveryStateBuilderInput,
  signals: string[],
): PlannerRecoveryState | undefined {
  const projection = input.projection;
  const lastResult = input.lastResult;
  if (
    !projection
    || !lastResult?.success
    || lastResult.kind !== 'navigate'
    || projection.stats.interactionCount > 0
    || projection.stats.readableCount > 0
    || projection.stats.navigationCount > 0
  ) {
    return undefined;
  }

  return {
    state: 'empty_navigation_surface',
    severity: 'warning',
    nextMechanisms: [
      'wait_for_hydration',
      'reobserve_current_surface',
      'avoid_navigation_churn',
      'escalate_if_surface_remains_empty',
    ],
    signals: [...signals, 'successful_navigation_empty_surface'],
  };
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
  if (!matchingGroup) {
    // Single-ref blindspot: retrying the SAME blocked element never reaches
    // two distinct refs, but it is still a persistent blocker. Fire on the
    // same-ref repeat count so the planner stops re-targeting it.
    const sameRefCount = sameEpoch.filter(failure => failure.targetRef === currentFailure.targetRef).length;
    if (sameRefCount < 2) return undefined;
    return {
      state: 'persistent_target_blocker',
      severity: 'warning',
      blockedAction: {
        tool: input.lastResult?.kind,
        ref: input.lastResult?.targetRef,
      },
      nextMechanisms: [
        'avoid_repeating_blocked_action',
        'find_dismiss_or_close_control',
        'reobserve_current_surface',
        'choose_unblocked_alternative',
      ],
      signals: [
        ...signals,
        `persistent_blocker:same_ref:${sameRefCount}`,
      ],
    };
  }

  // When the same blocker covers many distinct refs, no "unblocked alternative"
  // exists on the surface: the actionable move is dismissing the blocker (its
  // own controls are the reachable surface) or reporting honestly. Escalate
  // severity and re-lead the mechanisms once coverage is wide.
  if (matchingGroup.size >= 3) {
    return {
      state: 'surface_wide_blocker',
      severity: 'critical',
      blockedAction: {
        tool: input.lastResult?.kind ?? 'unknown',
        ref: input.lastResult?.targetRef,
      },
      nextMechanisms: [
        'avoid_repeating_blocked_action',
        'find_dismiss_or_close_control',
        'act_on_overlay_controls',
        'reobserve_current_surface',
        'escalate_if_surface_remains_blocked',
      ],
      signals: [
        ...signals,
        `persistent_blocker:${matchingGroup.size}`,
        `surface_wide_blocker:${matchingGroup.size}`,
      ],
    };
  }

  return {
    state: 'persistent_target_blocker',
    severity: 'warning',
    blockedAction: {
      tool: input.lastResult?.kind,
      ref: input.lastResult?.targetRef,
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

const UNRESPONSIVE_TIMEOUT_RUN = 3;

function buildUnresponsiveSurfaceRecovery(
  input: RecoveryStateBuilderInput,
  signals: string[],
): PlannerRecoveryState | undefined {
  if (input.lastResult?.error?.code !== 'timeout') return undefined;
  const timeoutRun = countTrailingTimeouts(input.failures ?? []);
  if (timeoutRun < UNRESPONSIVE_TIMEOUT_RUN) return undefined;

  return {
    state: 'unresponsive_surface',
    severity: 'warning',
    blockedAction: {
      tool: input.lastResult.kind,
      ref: input.lastResult.targetRef,
    },
    nextMechanisms: [
      'wait_for_hydration',
      'reobserve_current_surface',
      'avoid_repeated_actions_on_unresponsive_surface',
      'report_unresponsive_honestly',
    ],
    signals: [...signals, `unresponsive_surface:${timeoutRun}`],
  };
}

function countTrailingTimeouts(failures: FailureEvidence[]): number {
  let count = 0;
  for (let index = failures.length - 1; index >= 0; index -= 1) {
    if (failures[index].kind !== 'timeout') break;
    count += 1;
  }
  return count;
}

const REPEATED_TIMEOUT_SAME_TARGET = 2;

function buildRepeatedTimeoutTargetRecovery(
  input: RecoveryStateBuilderInput,
  signals: string[],
): PlannerRecoveryState | undefined {
  if (input.lastResult?.error?.code !== 'timeout') return undefined;
  const targetRef = input.lastResult.targetRef;
  if (!targetRef) return undefined;
  const sameTargetTimeouts = (input.failures ?? []).filter(failure =>
    failure.kind === 'timeout' && failure.targetRef === targetRef,
  ).length;
  if (sameTargetTimeouts < REPEATED_TIMEOUT_SAME_TARGET) return undefined;

  return {
    state: 'repeated_timeout_target',
    severity: 'warning',
    blockedAction: {
      tool: input.lastResult.kind,
      ref: targetRef,
    },
    nextMechanisms: [
      'avoid_repeating_blocked_action',
      'choose_alternative_ref',
      'expand_or_reobserve',
      'wait_for_hydration',
    ],
    signals: [...signals, `repeated_timeout:${targetRef}:${sameTargetTimeouts}`],
  };
}

function buildNavigationOscillationRecovery(
  input: RecoveryStateBuilderInput,
  signals: string[],
): PlannerRecoveryState | undefined {
  if (!signals.includes('navigation_oscillation')) return undefined;

  return {
    state: 'navigation_oscillation',
    severity: 'warning',
    nextMechanisms: [
      'avoid_navigation_churn',
      'commit_to_current_surface_until_progress',
      'act_on_visible_controls',
      'reobserve_current_surface',
    ],
    signals,
  };
}

function buildNavigateLoopRecovery(
  input: RecoveryStateBuilderInput,
  signals: string[],
): PlannerRecoveryState | undefined {
  if (!signals.includes('navigate_loop')) return undefined;

  return {
    state: 'navigate_loop',
    severity: 'warning',
    blockedAction: { tool: 'navigate' },
    nextMechanisms: [
      'press_enter_on_last_typed_field',
      'click_visible_submit_control',
      'act_on_visible_controls',
      'stop_if_dead_end_evidence_is_sufficient',
    ],
    signals,
  };
}

function buildClickNoNavigationRecovery(
  input: RecoveryStateBuilderInput,
  signals: string[],
): PlannerRecoveryState | undefined {
  if (!signals.includes('click_no_navigation')) return undefined;

  return {
    state: 'click_no_navigation',
    severity: 'warning',
    blockedAction: input.lastResult?.kind === 'click'
      ? { tool: 'click', ref: input.lastResult.targetRef }
      : undefined,
    nextMechanisms: [
      'read_link_target_before_clicking_again',
      'choose_alternative_ref',
      'expand_or_reobserve',
      'act_on_visible_controls',
    ],
    signals,
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
    'input_not_applied',
    'target_not_clickable',
    'target_blocked',
    'ambiguous_ref_resolution',
    'low_confidence_ref',
    'unselected_ref',
    'same_url_navigation',
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
    nextMechanisms: mechanismsForErrorCode(code, lastResult),
    signals,
  };
}

function mechanismsForErrorCode(code: string, lastResult?: V2ToolResult): string[] {
  if (code === 'target_not_editable' || code === 'input_not_applied') {
    return ['choose_typeable_ref', 'click_launcher_then_type', 'expand_or_reobserve'];
  }
  if (code === 'target_blocked' && lastResult?.error?.diagnostics?.hitTestOutcome === 'hard_blocker') {
    return [
      'avoid_repeating_blocked_action',
      'find_dismiss_or_close_control',
      'reobserve_current_surface',
      'choose_alternative_ref',
      'expand_or_reobserve',
    ];
  }
  if (code === 'target_not_clickable' || code === 'target_blocked' || code === 'low_confidence_ref') {
    return ['avoid_repeating_blocked_action', 'choose_alternative_ref', 'use_readable_evidence_if_goal_is_answerable', 'expand_or_reobserve'];
  }
  if (code === 'ambiguous_ref_resolution') {
    return ['choose_less_ambiguous_ref', 'inspect_region_or_scope', 'use_current_focus_or_overlay', 'expand_or_reobserve'];
  }
  if (code === 'same_url_navigation') {
    return ['avoid_navigation_churn', 'act_on_visible_controls', 'reobserve_current_surface'];
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
