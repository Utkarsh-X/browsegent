import type {
  Action,
  ActionEffectSignal,
  ActionEffectStrength,
  ActionEffectSummary,
  BrowserRuntimeState,
} from './types';

export function deriveActionEffect(
  action: Action,
  before: BrowserRuntimeState | null,
  after: BrowserRuntimeState | null,
  resultValue?: string,
): ActionEffectSummary | undefined {
  if (!before && !after && resultValue === undefined) {
    return undefined;
  }

  const signals: ActionEffectSignal[] = [];
  const afterValue = normalizeEffectText(resultValue ?? after?.targetValue);
  const beforeValue = normalizeEffectText(before?.targetValue);

  if (before && after) {
    if (before.baseUrl !== after.baseUrl) {
      signals.push('url_changed');
    } else if (before.hash !== after.hash) {
      signals.push('hash_changed');
    }

    if (Math.abs(before.scrollX - after.scrollX) >= 20 || Math.abs(before.scrollY - after.scrollY) >= 20) {
      signals.push('scroll_changed');
    }

    if ((before.focusKey ?? '') !== (after.focusKey ?? '')) {
      signals.push('focus_changed');
    }

    if (before.domSignature !== after.domSignature) {
      signals.push('dom_changed');
    }
  }

  if (
    action.kind === 'get'
    || action.kind === 'search_page'
    || action.kind === 'find_elements'
    || action.kind === 'count_elements'
    || action.kind === 'inspect_region'
  ) {
    if (afterValue !== undefined) {
      signals.push('target_value_observed');
    }
  } else if (action.kind === 'type' || action.kind === 'select') {
    if (afterValue !== undefined && afterValue !== beforeValue) {
      signals.push('target_value_changed');
    }
  }

  if (signals.length === 0) {
    signals.push('none');
  }

  const uniqueSignals = dedupeSignals(signals);
  const strength = deriveEffectStrength(action, uniqueSignals);

  return {
    stateChanged: uniqueSignals.some(signal => signal !== 'none' && signal !== 'target_value_observed'),
    primarySignal: uniqueSignals[0] ?? 'none',
    signals: uniqueSignals,
    strength,
    targetValue: afterValue,
  };
}

export function deriveEffectStrength(action: Action, signals: ActionEffectSignal[]): ActionEffectStrength {
  const hasSignal = (signal: ActionEffectSignal) => signals.includes(signal);

  if (hasSignal('url_changed')) {
    return 'strong';
  }

  if ((action.kind === 'type' || action.kind === 'select') && hasSignal('target_value_changed')) {
    return 'strong';
  }

  if (
    hasSignal('dom_changed')
    || hasSignal('hash_changed')
    || hasSignal('scroll_changed')
    || hasSignal('target_value_observed')
    || hasSignal('target_value_changed')
  ) {
    return 'weak';
  }

  if (hasSignal('focus_changed')) {
    return 'none';
  }

  if (signals.some(signal => signal !== 'none')) {
    return 'weak';
  }

  return 'none';
}

function normalizeEffectText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().replace(/\s+/g, ' ').slice(0, 240);
  return normalized;
}

function dedupeSignals(signals: ActionEffectSignal[]): ActionEffectSignal[] {
  return [...new Set(signals)];
}
