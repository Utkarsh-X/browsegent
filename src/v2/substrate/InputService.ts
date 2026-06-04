import type { Locator, Page } from 'playwright';

import { V2OperationalError } from '../runtime/errors';
import type { V2Ref } from '../runtime/types';
import { RefResolver } from './RefResolver';

export interface InputExecutionResult<TValue = unknown> {
  kind: 'click' | 'type' | 'select';
  value?: TValue;
}

export class InputService {
  private readonly resolver = new RefResolver();

  async click(ref: V2Ref, page: Page): Promise<InputExecutionResult> {
    this.assertExecutable(ref);
    this.assertActionCompatible(ref, 'click');
    const { locator } = await this.resolver.resolve(ref, page);
    await locator.scrollIntoViewIfNeeded({ timeout: 1_500 });

    if (await this.isCenterPointBlocked(locator)) {
      throw new V2OperationalError('target_blocked', 'Target center point is covered by another element.', { retryable: false });
    }

    try {
      await locator.click({ timeout: 1_500 });
    } catch (error) {
      throw mapPlaywrightError(error, 'click');
    }

    return { kind: 'click' };
  }

  async type(ref: V2Ref, text: string, page: Page): Promise<InputExecutionResult<{ inputValue: string }>> {
    this.assertExecutable(ref);
    this.assertActionCompatible(ref, 'type');
    const { locator } = await this.resolver.resolve(ref, page);
    await locator.scrollIntoViewIfNeeded({ timeout: 1_500 });

    try {
      await locator.fill(text, { timeout: 1_500 });
    } catch (error) {
      throw mapPlaywrightError(error, 'type');
    }

    const inputValue = await locator.evaluate((element) => {
      if ('value' in element) {
        return String((element as HTMLInputElement | HTMLTextAreaElement).value);
      }
      return String(element.textContent ?? '');
    });

    return {
      kind: 'type',
      value: { inputValue },
    };
  }

  async select(ref: V2Ref, value: string, page: Page): Promise<InputExecutionResult<{ value: string; selectedText: string }>> {
    this.assertExecutable(ref);
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

  private async isCenterPointBlocked(locator: Locator): Promise<boolean> {
    return locator.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return true;
      }

      const x = Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2));
      const y = Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2));
      const topElement = document.elementFromPoint(x, y);
      return Boolean(topElement && topElement !== element && !element.contains(topElement));
    });
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
