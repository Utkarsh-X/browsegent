import type { Locator, Page } from 'playwright';

import { V2OperationalError } from '../runtime/errors';
import type { V2Ref } from '../runtime/types';

export interface InputExecutionResult<TValue = unknown> {
  kind: 'click' | 'type';
  value?: TValue;
}

export class InputService {
  async click(ref: V2Ref, page: Page): Promise<InputExecutionResult> {
    this.assertExecutable(ref);
    const locator = await this.locatorForRef(ref, page);
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
    const locator = await this.locatorForRef(ref, page);
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

  private async locatorForRef(ref: V2Ref, page: Page): Promise<Locator> {
    for (const selector of ref.selectorCandidates) {
      try {
        const locator = page.locator(selector).first();
        if (await locator.count() > 0) {
          return locator;
        }
      } catch {
        continue;
      }
    }

    throw new V2OperationalError('stale_ref', `Ref "${ref.refId}" no longer resolves to a target.`, { retryable: false });
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

function mapPlaywrightError(error: unknown, action: 'click' | 'type'): V2OperationalError {
  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();

  if (lowered.includes('timeout')) {
    return new V2OperationalError('timeout', `${action} timed out before the target became stable.`, { retryable: true });
  }

  if (lowered.includes('not visible') || lowered.includes('hidden')) {
    return new V2OperationalError('target_hidden', `Target was not visible during ${action}.`, { retryable: false });
  }

  if (lowered.includes('disabled')) {
    return new V2OperationalError('target_disabled', `Target was disabled during ${action}.`, { retryable: false });
  }

  if (lowered.includes('intercepts pointer events') || lowered.includes('not receive pointer events')) {
    return new V2OperationalError('target_blocked', `Target was blocked during ${action}.`, { retryable: false });
  }

  return new V2OperationalError('timeout', `${action} failed before completion: ${message}`, { retryable: true });
}
