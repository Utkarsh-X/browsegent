import type { ElementHandle, JSHandle, Locator, Page } from 'playwright';

import { V2OperationalError } from '../runtime/errors';
import type { V2Ref } from '../runtime/types';
import { RefResolver } from './RefResolver';
import { semanticHitTest } from './semanticHitTest';
import type { HitTestVerdict } from './semanticHitTest';

interface SuggestionControlMetadata {
  role?: string;
  ariaAutocomplete?: string;
  ariaHasPopup?: string;
}

interface SuggestionControlState {
  requiresOpen: boolean;
  useKeyboardInput: boolean;
  suggestionBacked: boolean;
  visibleOptionCount: number;
  hasExpectedOption?: boolean;
}

export interface InputExecutionResult<TValue = unknown> {
  kind: 'click' | 'type' | 'select';
  value?: TValue;
  interactionEvidence?: {
    clickEventObserved: boolean;
    targetConnectedAfterAction: boolean;
  };
}

interface ClickErrorFromVerdict {
  code: 'target_blocked' | 'target_hidden';
  message: string;
  retryable: boolean;
  diagnostics?: Record<string, unknown>;
}

export function buildClickErrorFromVerdict(
  verdict: HitTestVerdict,
  refName: string | undefined,
  refRole: string | undefined,
): ClickErrorFromVerdict | undefined {
  if (verdict.outcome === 'clear_target' || verdict.outcome === 'semantic_relation' || verdict.outcome === 'soft_ambiguity') {
    return undefined;
  }

  if (verdict.outcome === 'zero_size_or_hidden') {
    return {
      code: 'target_hidden',
      message: `Target '${refName ?? 'unknown'}' (${refRole ?? 'element'}) is not interactable: ${verdict.detail}.`,
      retryable: false,
    };
  }

  // hard_blocker
  const b = verdict.blocker;
  const retryable = b.isFixedOrSticky && !b.coversFullViewport;
  const positionNote = b.isFixedOrSticky ? ' Position: fixed/sticky.' : '';
  const actionHint = b.coversFullViewport
    ? 'Dismiss the full-viewport overlay first.'
    : 'Dismiss or interact with the covering element first.';

  return {
    code: 'target_blocked',
    message: `Target '${refName ?? 'unknown'}' (${refRole ?? 'element'}) is covered by <${b.description}${b.anchorDescription ? ` inside ${b.anchorDescription}` : ''}> at its click point.${positionNote} ${actionHint}`,
    retryable,
    diagnostics: {
      blockerDescription: b.description,
      blockerTagName: b.tagName,
      blockerId: b.id,
      blockerClassList: b.classList,
      blockerAnchor: b.anchorDescription,
      blockerIsFixedOrSticky: b.isFixedOrSticky,
      blockerCoversFullViewport: b.coversFullViewport,
      blockerIsTransparent: b.isTransparent,
      blockerIsNativeDialog: b.isNativeDialog,
      probePointsTested: 7,
      hitTestOutcome: 'hard_blocker',
    },
  };
}

export class InputService {
  private readonly resolver = new RefResolver();

  async click(ref: V2Ref, page: Page): Promise<InputExecutionResult> {
    this.assertExecutable(ref);
    this.assertActionCompatible(ref, 'click');
    const { locator } = await this.resolver.resolve(ref, page);
    await locator.scrollIntoViewIfNeeded({ timeout: 1_500 });
    const target = await locator.elementHandle();
    if (!target) {
      throw new V2OperationalError('stale_ref', 'Target no longer resolves to an attached element.', { retryable: false });
    }

    const { verdict, position } = await semanticHitTest(target);

    // Check for non-clickable verdicts
    const clickError = buildClickErrorFromVerdict(verdict, ref.name, ref.role);
    if (clickError) {
      await target.dispose();
      throw new V2OperationalError(clickError.code, clickError.message, {
        retryable: clickError.retryable,
        diagnostics: clickError.diagnostics,
      });
    }

    // Determine force mode: semantic_relation uses force:true to avoid
    // Playwright's redundant overlay check that false-positives on label/shadow patterns.
    const useForce = verdict.outcome === 'semantic_relation';

    let clickOutcome: JSHandle<{ clickEventObserved: boolean }> | undefined;
    try {
      clickOutcome = await target.evaluateHandle((element) => {
        const outcome = { clickEventObserved: false };
        element.addEventListener('click', () => {
          outcome.clickEventObserved = true;
        }, { capture: true, once: true });
        return outcome;
      });
      await target.click({
        timeout: 1_500,
        // BrowseGent settles and observes the page after every mutation;
        // avoid Playwright waiting on the same navigation a second time.
        noWaitAfter: true,
        ...(position ? { position } : {}),
        ...(useForce ? { force: true } : {}),
      });
      const [clickEventObserved, targetConnectedAfterAction] = await Promise.all([
        clickOutcome.evaluate(outcome => outcome.clickEventObserved),
        target.evaluate(element => element.isConnected),
      ]);
      return {
        kind: 'click',
        interactionEvidence: {
          clickEventObserved,
          targetConnectedAfterAction,
        },
      };
    } catch (error) {
      throw mapPlaywrightError(error, 'click');
    } finally {
      await clickOutcome?.dispose();
      await target.dispose();
    }
  }

  async type(ref: V2Ref, text: string, page: Page): Promise<InputExecutionResult<{ inputValue: string }>> {
    this.assertExecutable(ref);
    this.assertActionCompatible(ref, 'type');
    let { locator } = await this.resolver.resolve(ref, page);
    await locator.scrollIntoViewIfNeeded({ timeout: 1_500 });

    const suggestionState = await inspectSuggestionControl(locator, ref);
    let keyboardOpened = false;
    if (suggestionState.requiresOpen) {
      keyboardOpened = await tryOpenSuggestionWithKeyboard(locator, ref, text);
    }

    // Try the editable control directly before opening it physically. A widget
    // can accept input while a decorative or transient element covers its click
    // point; a click-first protocol would turn valid input into target_blocked.
    try {
      await locator.fill(text, { timeout: 1_500 });
    } catch (error) {
      throw mapPlaywrightError(error, 'type');
    }

    let inputValue = await locator.evaluate((element) => {
      if ('value' in element) {
        return String((element as HTMLInputElement | HTMLTextAreaElement).value);
      }
      return String(element.textContent ?? '');
    });

    if (suggestionState.requiresOpen && !keyboardOpened && !inputValue.trim()) {
      // Some ARIA comboboxes reject values until their suggestion surface is
      // open. Retry keyboard semantics after the first fill because some
      // widgets only expose their list after receiving input.
      keyboardOpened = await tryOpenSuggestionWithKeyboard(locator, ref, text);

      if (!keyboardOpened) {
        // A pointer-blocked control may still accept focus and real keyboard
        // input. Try that path before asking semantic hit testing to click it.
        const keyboardInputValue = await tryKeyboardInput(locator, text);
        if (keyboardInputValue.trim()) {
          inputValue = keyboardInputValue;
        } else {
          await this.click(ref, page);
          ({ locator } = await this.resolver.resolve(ref, page));
          await locator.scrollIntoViewIfNeeded({ timeout: 1_500 });
        }
      }

      if (!inputValue.trim()) {
        try {
          await locator.fill(text, { timeout: 1_500 });
        } catch (error) {
          throw mapPlaywrightError(error, 'type');
        }

        inputValue = await locator.evaluate((element) => {
          if ('value' in element) {
            return String((element as HTMLInputElement | HTMLTextAreaElement).value);
          }
          return String(element.textContent ?? '');
        });
      }
    }

    // Some suggestion widgets retain fill()'s value but only refresh their
    // options from keyboard events. Retry that interaction path only when the
    // visible suggestion surface is clearly unrelated to the requested text.
    const postFillSuggestion = await waitForSuggestionState(locator, ref, text);
    if (postFillSuggestion.useKeyboardInput) {
      try {
        await locator.fill('', { timeout: 1_500 });
        await locator.pressSequentially(text, { delay: 10, timeout: 1_500 });
      } catch (error) {
        throw mapPlaywrightError(error, 'type');
      }

      inputValue = await locator.evaluate((element) => {
        if ('value' in element) {
          return String((element as HTMLInputElement | HTMLTextAreaElement).value);
        }
        return String(element.textContent ?? '');
      });
    }

    // Playwright can complete a fill against a controlled or stale widget
    // without the widget retaining the requested non-empty value. Do not
    // report that mutation as successful; the planner needs a truthful
    // failure so it can re-observe and choose another interaction.
    if (text.trim() && !inputValue.trim()) {
      const retention = await locator.evaluate((element) => ({
        activeElement: document.activeElement?.tagName?.toLowerCase(),
        targetConnected: element.isConnected,
      })).catch(() => undefined);
      const diagnostics: Record<string, unknown> = {
        requestedLength: text.length,
        observedLength: inputValue.length,
        targetRole: ref.role,
        targetName: ref.name,
        requestedValue: isSensitiveInput(ref) ? undefined : compactDiagnosticValue(text),
        retainedValue: isSensitiveInput(ref) ? undefined : compactDiagnosticValue(inputValue),
      };
      if (retention && typeof retention === 'object') {
        diagnostics.activeElement = retention.activeElement;
        diagnostics.targetConnected = retention.targetConnected;
      }

      throw new V2OperationalError(
        'input_not_applied',
        'The target accepted the fill call but did not retain a non-empty input value.',
        {
          retryable: false,
          diagnostics,
        },
      );
    }

    return {
      kind: 'type',
      value: { inputValue },
    };
  }

  /**
   * Suggestion-commit primitive (`pick_option`): open the suggestion surface
   * if collapsed, fill the requested value, wait for options, click the single
   * matching option, and verify the control retained a value. The planner
   * decides WHAT to commit; the substrate owns the mechanical iterations.
   * Honest refusals: `suggestion_surface_did_not_open`, `no_matching_option`
   * (observed labels returned in diagnostics), `ambiguous_match`, and the
   * existing retention check. Never presses Enter — that is a different
   * commitment semantics the planner must choose explicitly.
   */
  async pickOption(ref: V2Ref, text: string, page: Page): Promise<InputExecutionResult<{ committed: string }>> {
    this.assertExecutable(ref);
    this.assertActionCompatible(ref, 'type');
    let { locator } = await this.resolver.resolve(ref, page);
    await locator.scrollIntoViewIfNeeded({ timeout: 1_500 });

    const openState = await inspectSuggestionControl(locator, ref);
    if (!openState.suggestionBacked) {
      throw new V2OperationalError(
        'suggestion_surface_did_not_open',
        'Target is not a suggestion-backed control (no aria-autocomplete/aria-haspopup=listbox protocol).',
        { retryable: false, diagnostics: { targetRole: ref.role, targetName: ref.name } },
      );
    }
    if (openState.requiresOpen) {
      const opened = await tryOpenSuggestionWithKeyboard(locator, ref, text);
      if (!opened) {
        await this.click(ref, page);
        ({ locator } = await this.resolver.resolve(ref, page));
        await locator.scrollIntoViewIfNeeded({ timeout: 1_500 }).catch(() => undefined);
      }
    }

    try {
      await locator.fill(text, { timeout: 1_500 });
    } catch (error) {
      throw mapPlaywrightError(error, 'type');
    }

    const state = await waitForSuggestionState(locator, ref, text);
    if (!state.suggestionBacked || (state.visibleOptionCount === 0 && !state.hasExpectedOption)) {
      throw new V2OperationalError(
        'suggestion_surface_did_not_open',
        'The suggestion surface did not expose options for the requested value.',
        { retryable: true, diagnostics: { requestedValue: isSensitiveInput(ref) ? undefined : compactDiagnosticValue(text) } },
      );
    }

    const survey = await locator.evaluate((element, requested) => {
      const normalize = (value: string | null | undefined): string => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
      const isVisible = (candidate: Element): boolean => {
        const html = candidate as HTMLElement;
        if (candidate.hasAttribute('hidden')) return false;
        const style = window.getComputedStyle(html);
        const rect = html.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const controlledId = element.getAttribute('aria-controls');
      const optionRoot: ParentNode = controlledId ? document.getElementById(controlledId) ?? document : document;
      const options = Array.from(optionRoot.querySelectorAll('[role="option"]')).filter(isVisible);
      const labels = options.map(option => (option.textContent ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
      const requestedNorm = normalize(requested);
      const exact = labels.filter(label => normalize(label) === requestedNorm);
      const partial = labels.filter(label => normalize(label).includes(requestedNorm) && requestedNorm.length > 1);
      if (exact.length === 1) return { status: 'match' as const, matchedLabel: exact[0], labels };
      if (exact.length > 1) return { status: 'ambiguous' as const, labels };
      if (partial.length === 1) return { status: 'match' as const, matchedLabel: partial[0], labels };
      if (partial.length > 1) return { status: 'ambiguous' as const, labels };
      return { status: 'no_match' as const, labels };
    }, text);

    if (survey.status !== 'match') {
      throw new V2OperationalError(
        survey.status === 'ambiguous' ? 'ambiguous_match' : 'no_matching_option',
        survey.status === 'ambiguous'
          ? 'Multiple suggestion options match the requested value; refusing to guess.'
          : 'No suggestion option matches the requested value.',
        {
          retryable: true,
          diagnostics: {
            requestedValue: isSensitiveInput(ref) ? undefined : compactDiagnosticValue(text),
            observedOptions: survey.labels.slice(0, 8),
          },
        },
      );
    }

    const candidate = page.getByRole('option', { name: survey.matchedLabel, exact: true });
    const candidateCount = await candidate.count();
    if (candidateCount !== 1) {
      throw new V2OperationalError(
        'ambiguous_match',
        `The matching option resolved to ${candidateCount} clickable candidates; refusing to guess.`,
        { retryable: true, diagnostics: { observedOptions: survey.labels.slice(0, 8) } },
      );
    }

    try {
      await candidate.click({ timeout: 1_500, noWaitAfter: true });
    } catch (error) {
      throw mapPlaywrightError(error, 'click');
    }

    const inputValue = await locator.evaluate((element) => {
      if ('value' in element) {
        return String((element as HTMLInputElement | HTMLTextAreaElement).value);
      }
      return String(element.textContent ?? '');
    });
    if (!inputValue.trim()) {
      throw new V2OperationalError(
        'input_not_applied',
        'The option was clicked but the control did not retain a value.',
        { retryable: false, diagnostics: { requestedValue: isSensitiveInput(ref) ? undefined : compactDiagnosticValue(text) } },
      );
    }

    return {
      kind: 'click',
      value: { committed: survey.matchedLabel },
    };
  }

  async select(ref: V2Ref, value: string, page: Page): Promise<InputExecutionResult<{ value: string; selectedText: string }>> {    this.assertExecutable(ref);
    this.assertActionCompatible(ref, 'select');
    const { locator } = await this.resolver.resolve(ref, page);
    await locator.scrollIntoViewIfNeeded({ timeout: 1_500 });

    const isNativeSelect = await locator.evaluate((element) => element instanceof HTMLSelectElement);
    if (!isNativeSelect) {
      throw new V2OperationalError('target_not_selectable', 'Target is not a native select control.', { retryable: false });
    }

    try {
      await locator.selectOption({ label: value }, { timeout: 1_500 });
    } catch (error) {
      throw mapPlaywrightError(error, 'select');
    }

    const selected = await locator.evaluate((element) => {
      const select = element as HTMLSelectElement;
      const selectedOption = select.selectedOptions[0];
      return {
        value: select.value,
        selectedText: selectedOption?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      };
    });

    return {
      kind: 'select',
      value: selected,
    };
  }

  private assertExecutable(ref: V2Ref): void {
    if (ref.visibility === 'hidden') {
      throw new V2OperationalError('target_hidden', 'Target is hidden and cannot be executed.', { retryable: false });
    }

    if (ref.actionability === 'disabled') {
      throw new V2OperationalError('target_disabled', 'Target is disabled and cannot be executed.', { retryable: false });
    }

    if (ref.actionability === 'blocked') {
      throw new V2OperationalError('target_blocked', 'Target is blocked and cannot be executed.', { retryable: false });
    }
  }

  private assertActionCompatible(ref: V2Ref, action: 'click' | 'type' | 'select'): void {
    if (action === 'click' && ref.capabilities?.clickable === false) {
      throw new V2OperationalError('target_not_clickable', 'Target is not a clickable control.', { retryable: false });
    }

    if (action === 'type' && ref.capabilities?.typeable === false) {
      throw new V2OperationalError('target_not_editable', 'Target is not a typeable control.', { retryable: false });
    }

    if (action === 'select' && ref.capabilities?.selectable === false) {
      throw new V2OperationalError('target_not_selectable', 'Target is not a selectable control.', { retryable: false });
    }
  }

}

function mapPlaywrightError(error: unknown, action: 'click' | 'type' | 'select'): V2OperationalError {
  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();

  if (lowered.includes('not visible') || lowered.includes('hidden')) {
    return new V2OperationalError('target_hidden', `Target was not visible during ${action}.`, { retryable: false });
  }

  if (lowered.includes('disabled')) {
    return new V2OperationalError('target_disabled', `Target was disabled during ${action}.`, { retryable: false });
  }

  if (lowered.includes('intercepts pointer events') || lowered.includes('not receive pointer events')) {
    return new V2OperationalError('target_blocked', `Target was blocked during ${action}.`, { retryable: false });
  }

  if (lowered.includes('element is detached') || lowered.includes('element was detached')) {
    return new V2OperationalError('element_detached', `Target detached during ${action}.`, { retryable: false });
  }

  if (
    action === 'type'
    && (
      lowered.includes('not an <input>')
      || lowered.includes('not an input')
      || lowered.includes('not editable')
      || lowered.includes('is not editable')
      || lowered.includes('does not have a role allowing')
    )
  ) {
    return new V2OperationalError('target_not_editable', `Target was not editable during ${action}.`, { retryable: false });
  }

  if (
    action === 'click'
    && (
      lowered.includes('not clickable')
      || lowered.includes('not enabled')
      || lowered.includes('not attached')
    )
  ) {
    return new V2OperationalError('target_not_clickable', `Target was not clickable during ${action}.`, { retryable: false });
  }

  if (
    action === 'select'
    && (
      lowered.includes('not a <select>')
      || lowered.includes('did not find some options')
      || lowered.includes('option')
    )
  ) {
    return new V2OperationalError('target_not_selectable', `Target could not select the requested option during ${action}.`, { retryable: false });
  }

  if (lowered.includes('timeout')) {
    return new V2OperationalError('timeout', `${action} timed out before the target became stable.`, { retryable: true });
  }

  return new V2OperationalError('timeout', `${action} failed before completion: ${message}`, { retryable: true });
}

async function inspectSuggestionControl(
  locator: Locator,
  ref: SuggestionControlMetadata,
  expectedText?: string,
): Promise<SuggestionControlState> {
  const state = await locator.evaluate((element, metadata) => {
    const helpers = {
      normalize(value: string | null | undefined): string {
        return String(value ?? '').trim().toLowerCase();
      },
      isVisible(candidate: Element): boolean {
        const html = candidate as HTMLElement;
        if (candidate.hasAttribute('hidden')) return false;
        const style = window.getComputedStyle(html);
        const rect = html.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0;
      },
      matchesExpected(candidate: Element, expected: string): boolean {
        const optionText = helpers.normalize(candidate.textContent);
        const expectedText = helpers.normalize(expected);
        return expectedText.length > 1
          && (optionText === expectedText || optionText.includes(expectedText));
      },
    };
    const role = helpers.normalize(element.getAttribute('role') || metadata.role);
    const autocomplete = helpers.normalize(element.getAttribute('aria-autocomplete') || metadata.ariaAutocomplete);
    const hasPopup = helpers.normalize(element.getAttribute('aria-haspopup') || metadata.ariaHasPopup);
    const suggestionBacked = (role === 'combobox' || role === 'searchbox')
      && (autocomplete === 'list' || autocomplete === 'both' || autocomplete === 'inline' || hasPopup === 'listbox');

    if (!suggestionBacked) {
      return {
        requiresOpen: false,
        useKeyboardInput: false,
        suggestionBacked: false,
        visibleOptionCount: 0,
      };
    }

    const controlledId = element.getAttribute('aria-controls');
    const controlled = controlledId ? document.getElementById(controlledId) : undefined;
    const optionRoot: ParentNode = controlled ?? document;
    const visibleOptions = Array.from(optionRoot.querySelectorAll('[role="option"]')).filter(helpers.isVisible);
    const visibleOptionCount = visibleOptions.length;
    const expanded = helpers.normalize(element.getAttribute('aria-expanded')) === 'true';
    const expected = String(metadata.expectedText ?? '');
    const hasExpectedOption = expected.length > 1
      && visibleOptions.some(option => helpers.matchesExpected(option, expected));

    return {
      requiresOpen: !expanded && visibleOptionCount === 0,
      useKeyboardInput: expected.length > 1 && visibleOptionCount > 0 && !hasExpectedOption,
      suggestionBacked: true,
      visibleOptionCount,
    };
  }, {
    role: ref.role,
    ariaAutocomplete: ref.ariaAutocomplete,
    ariaHasPopup: ref.ariaHasPopup,
    expectedText,
  });

  return state;
}

async function waitForSuggestionState(
  locator: Locator,
  ref: SuggestionControlMetadata,
  expectedText: string,
  maxWaitMs = 750,
): Promise<SuggestionControlState> {
  let state = await inspectSuggestionControl(locator, ref, expectedText);
  if (!state.suggestionBacked || state.useKeyboardInput || state.visibleOptionCount > 0) {
    return state;
  }

  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 50));
    try {
      state = await inspectSuggestionControl(locator, ref, expectedText);
    } catch {
      return state;
    }
    if (!state.suggestionBacked || state.useKeyboardInput || state.visibleOptionCount > 0) {
      return state;
    }
  }

  return state;
}

async function tryOpenSuggestionWithKeyboard(
  locator: Locator,
  ref: SuggestionControlMetadata,
  expectedText: string,
): Promise<boolean> {
  try {
    await locator.press('ArrowDown', { timeout: 1_500 });
    return (await waitForSuggestionState(locator, ref, expectedText)).visibleOptionCount > 0;
  } catch {
    return false;
  }
}

async function tryKeyboardInput(locator: Locator, text: string): Promise<string> {
  try {
    await locator.focus({ timeout: 1_500 });
    await locator.fill('', { timeout: 1_500 });
    await locator.pressSequentially(text, { delay: 10, timeout: 1_500 });
    return await locator.evaluate((element) => {
      if ('value' in element) {
        return String((element as HTMLInputElement | HTMLTextAreaElement).value);
      }
      return String(element.textContent ?? '');
    });
  } catch {
    return '';
  }
}

function isSensitiveInput(ref: V2Ref): boolean {
  return ref.inputType?.trim().toLowerCase() === 'password';
}

function compactDiagnosticValue(value: string, maxLength = 160): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}
