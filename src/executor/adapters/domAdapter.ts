import type { CDPSession, Page } from 'playwright';
import { getRuntimeConfig } from '../../config/runtime';
import { logger } from '../../logger';
import { AdapterError } from '../browserAdapter';
import type { BrowserAdapter } from '../browserAdapter';
import type { ActionTargetHint, BrowserRuntimeState } from '../types';
import { capturePageRuntimeState } from './runtimeState';
import {
  countElementsSummary,
  findElementsSummary,
  inspectRegionSummary,
  searchPageText,
} from './readTools';

type DomActionResult<T = unknown> =
  | { ok: true; value?: T }
  | { ok: false; code: 'not_found' | 'not_interactable' | 'timeout' | 'execution_error'; message: string };

type CdpClickResult =
  | 'ok'
  | 'unsupported_frame'
  | 'geometry_unavailable'
  | 'occluded'
  | 'stale_target'
  | 'ambiguous_recovery_required'
  | 'timeout'
  | 'cdp_unavailable'
  | 'execution_error';

interface CdpOutcomePolicy {
  action: 'return' | 'fallback' | 'throw';
  errorCode?: 'blocked' | 'not_found' | 'not_interactable' | 'timeout';
  reason: string;
}

const CDP_EVENT_TIMEOUT_MS = {
  move: 1000,
  down: 2500,
  up: 3000,
} as const;
const CDP_GEOMETRY_RETRY_DELAY_MS = 120;

export function resolveCdpOutcomePolicy(result: CdpClickResult): CdpOutcomePolicy {
  switch (result) {
    case 'ok':
      return { action: 'return', reason: 'success' };
    case 'unsupported_frame':
      return { action: 'throw', errorCode: 'blocked', reason: 'unsupported_frame' };
    case 'ambiguous_recovery_required':
      return { action: 'throw', errorCode: 'blocked', reason: 'ambiguous_recovery_required' };
    case 'stale_target':
      return { action: 'throw', errorCode: 'not_found', reason: 'stale_target' };
    case 'occluded':
      return { action: 'throw', errorCode: 'not_interactable', reason: 'occluded' };
    case 'geometry_unavailable':
      return { action: 'throw', errorCode: 'not_interactable', reason: 'geometry_unavailable' };
    case 'timeout':
      return { action: 'throw', errorCode: 'timeout', reason: 'timeout' };
    case 'cdp_unavailable':
      return { action: 'fallback', reason: 'cdp_unavailable' };
    case 'execution_error':
      return { action: 'fallback', reason: 'execution_error' };
  }
}

export function shouldRetryCdpClickSameTarget(result: CdpClickResult): boolean {
  return result === 'geometry_unavailable' || result === 'timeout';
}

export function shouldAttemptCdpSelectorRecovery(result: CdpClickResult): boolean {
  return result === 'execution_error'
    || result === 'geometry_unavailable'
    || result === 'stale_target'
    || result === 'timeout';
}

function compilePatternMatcher(pattern: string): { mode: 'regex' | 'text'; pattern: string } {
  try {
    new RegExp(pattern, 'i');
    return { mode: 'regex', pattern };
  } catch {
    return { mode: 'text', pattern };
  }
}

async function runDomResult<T>(page: Page, fn: () => Promise<DomActionResult<T>>): Promise<T> {
  const result = await fn();
  if (!result.ok) {
    throw new AdapterError(result.code, result.message, 'dom');
  }
  return result.value as T;
}

export class DomBrowserAdapter implements BrowserAdapter {
  readonly runtime = 'dom' as const;
  private readonly cdpClickEnabled = getRuntimeConfig().executor.cdpClickEnabled;

  constructor(private readonly page?: Page) {}

  async isAvailable(): Promise<boolean> {
    if (!this.page) return false;
    return this.page.evaluate(() => typeof document !== 'undefined').catch(() => false);
  }

  async captureState(target?: string): Promise<BrowserRuntimeState> {
    const page = this.requirePage();
    return capturePageRuntimeState(page, target);
  }

  async click(target: string, targetHint?: ActionTargetHint): Promise<void> {
    const page = this.requirePage();
    if (this.cdpClickEnabled && typeof targetHint?.backendNodeId === 'number') {
      const cdpResult = await this.tryCdpClick(page, target, targetHint);
      const outcome = resolveCdpOutcomePolicy(cdpResult);
      if (outcome.action === 'return') {
        return;
      }
      if (outcome.action === 'throw') {
        const errorCode = outcome.errorCode ?? 'execution_error';
        if (errorCode === 'blocked' && cdpResult === 'unsupported_frame') {
          throw new AdapterError(
            'blocked',
            `Unsupported frame target for identity-backed click: ${target} (${targetHint.frameId ?? 'unknown'})`,
            this.runtime,
          );
        }
        if (errorCode === 'blocked' && cdpResult === 'ambiguous_recovery_required') {
          throw new AdapterError(
            'blocked',
            `Ambiguous selector recovery required for ${target}. Re-observe and replan.`,
            this.runtime,
          );
        }
        throw new AdapterError(
          errorCode,
          `Identity-backed click failed (${outcome.reason}) for target: ${target}`,
          this.runtime,
        );
      }
      logger.warn('executor:dom', 'CDP click path failed, falling back to DOM click', {
        target,
        backendNodeId: targetHint.backendNodeId,
        reason: cdpResult,
      });
    }
    await runDomResult(page, () =>
      page.evaluate((selector): DomActionResult => {
        let el: HTMLElement | null = null;
        try {
          el = document.querySelector(selector) as HTMLElement | null;
        } catch (err) {
          return { ok: false, code: 'execution_error', message: `Invalid selector: ${selector} (${String(err)})` };
        }
        if (!el) return { ok: false, code: 'not_found', message: `Element not found: ${selector}` };
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') {
          return { ok: false, code: 'not_interactable', message: `Element not interactable: ${selector}` };
        }
        try {
          el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
          el.click();
          return { ok: true };
        } catch (err) {
          return { ok: false, code: 'execution_error', message: String(err) };
        }
      }, target),
    );
  }

  async type(target: string, input: string, opts?: { clear: boolean }): Promise<void> {
    const page = this.requirePage();
    await runDomResult(page, () =>
      page.evaluate(([selector, value, clear]): DomActionResult => {
        let el: HTMLInputElement | HTMLTextAreaElement | HTMLElement | null = null;
        try {
          el = document.querySelector(selector) as
          | HTMLInputElement
          | HTMLTextAreaElement
          | HTMLElement
          | null;
        } catch (err) {
          return { ok: false, code: 'execution_error', message: `Invalid selector: ${selector} (${String(err)})` };
        }
        if (!el) return { ok: false, code: 'not_found', message: `Element not found: ${selector}` };
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') {
          return { ok: false, code: 'not_interactable', message: `Element not interactable: ${selector}` };
        }
        try {
          el.focus();
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            const proto = el instanceof HTMLInputElement
              ? HTMLInputElement.prototype
              : HTMLTextAreaElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (clear && setter) setter.call(el, '');
            if (setter) setter.call(el, value);
            else (el as HTMLInputElement).value = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true };
          }
          if (el.isContentEditable) {
            if (clear) el.textContent = '';
            el.textContent = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true };
          }
          return { ok: false, code: 'not_interactable', message: `Element does not accept text: ${selector}` };
        } catch (err) {
          return { ok: false, code: 'execution_error', message: String(err) };
        }
      }, [target, input, opts?.clear ?? true] as const),
    );
  }

  async scroll(direction: 'down' | 'up'): Promise<void> {
    const page = this.requirePage();
    await page.evaluate((dir: 'down' | 'up') => {
      const delta = dir === 'down' ? 600 : -600;
      window.scrollBy({ top: delta, behavior: 'smooth' });
    }, direction);
  }

  async readValue(target: string): Promise<{ found: boolean; value: string }> {
    const page = this.requirePage();
    return page.evaluate((selector) => {
      let el: HTMLInputElement | HTMLTextAreaElement | HTMLElement | null = null;
      try {
        el = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | HTMLElement | null;
      } catch {
        return { found: false, value: '' };
      }
      if (!el) return { found: false, value: '' };
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        return { found: true, value: el.value ?? '' };
      }
      return { found: true, value: el.textContent?.trim() ?? '' };
    }, target);
  }

  async searchPage(pattern: string, scopeSelector?: string): Promise<string> {
    const page = this.requirePage();
    return searchPageText(page, pattern, scopeSelector);
  }

  async findElements(selector: string): Promise<string> {
    const page = this.requirePage();
    return findElementsSummary(page, selector);
  }

  async countElements(selector: string): Promise<string> {
    const page = this.requirePage();
    return countElementsSummary(page, selector);
  }

  async inspectRegion(selector: string): Promise<string> {
    const page = this.requirePage();
    return inspectRegionSummary(page, selector);
  }

  async selectOption(target: string, option: string): Promise<void> {
    const page = this.requirePage();
    await runDomResult(page, () =>
      page.evaluate(([selector, value]): DomActionResult => {
        let el: HTMLSelectElement | null = null;
        try {
          el = document.querySelector(selector) as HTMLSelectElement | null;
        } catch (err) {
          return { ok: false, code: 'execution_error', message: `Invalid selector: ${selector} (${String(err)})` };
        }
        if (!el) return { ok: false, code: 'not_found', message: `Element not found: ${selector}` };
        try {
          el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true };
        } catch (err) {
          return { ok: false, code: 'execution_error', message: String(err) };
        }
      }, [target, option] as const),
    );
  }

  async waitForPattern(pattern: string, timeoutMs: number): Promise<boolean> {
    const page = this.requirePage();
    const matcher = compilePatternMatcher(pattern);
    return page.waitForFunction(
      ([mode, source]) => {
        const text = document.body?.innerText ?? document.documentElement?.textContent ?? '';
        if (mode === 'regex') {
          return new RegExp(source, 'i').test(text);
        }
        return text.toLowerCase().includes(source.toLowerCase());
      },
      [matcher.mode, matcher.pattern] as const,
      { timeout: timeoutMs },
    ).then(() => true).catch(() => false);
  }

  async sleep(timeoutMs: number): Promise<void> {
    const page = this.requirePage();
    await page.waitForTimeout(timeoutMs);
  }

  async recordClickCause(target: string): Promise<void> {
    const page = this.requirePage();
    await page.evaluate((selector) => {
      if ((window as any).__browsegent_brain2?.recordClick) {
        (window as any).__browsegent_brain2.recordClick(selector);
      }
    }, target).catch(() => {});
  }

  private async tryCdpClick(page: Page, target: string, targetHint: ActionTargetHint): Promise<CdpClickResult> {
    let cdpSession: CDPSession | null = null;
    try {
      cdpSession = await page.context().newCDPSession(page);
      if (typeof targetHint.backendNodeId !== 'number') {
        return 'execution_error';
      }

      const originalBackendNodeId = targetHint.backendNodeId;
      let clickResult = await this.clickBackendNode(
        cdpSession,
        page,
        target,
        originalBackendNodeId,
        targetHint.frameId,
        targetHint.nth,
      );
      if (clickResult === 'ok' || clickResult === 'unsupported_frame' || clickResult === 'occluded') {
        return clickResult;
      }

      if (shouldRetryCdpClickSameTarget(clickResult)) {
        await page.waitForTimeout(CDP_GEOMETRY_RETRY_DELAY_MS);
        const sameTargetRetry = await this.clickBackendNode(
          cdpSession,
          page,
          target,
          originalBackendNodeId,
          targetHint.frameId,
          targetHint.nth,
        );
        if (sameTargetRetry === 'ok' || sameTargetRetry === 'unsupported_frame' || sameTargetRetry === 'occluded') {
          return sameTargetRetry;
        }
        clickResult = sameTargetRetry;
      }

      if (!shouldAttemptCdpSelectorRecovery(clickResult)) {
        return clickResult;
      }
      if (targetHint.ambiguousSelector) {
        logger.warn('executor:dom', 'Stale target recovery blocked due to ambiguous selector', {
          target,
          refId: targetHint.refId,
          backendNodeId: targetHint.backendNodeId,
        });
        return 'ambiguous_recovery_required';
      }

      const recovered = await this.resolveBackendNodeBySelector(cdpSession, target, targetHint.nth);
      if (!recovered) {
        return clickResult === 'stale_target' ? 'stale_target' : clickResult;
      }
      if (recovered.backendNodeId === originalBackendNodeId && clickResult === 'stale_target') {
        return 'stale_target';
      }

      logger.info('executor:dom', 'Recovered stale backend node id for click target', {
        target,
        previousBackendNodeId: originalBackendNodeId,
        recoveredBackendNodeId: recovered.backendNodeId,
        previousFrameId: targetHint.frameId,
        recoveredFrameId: recovered.frameId,
      });

      clickResult = await this.clickBackendNode(
        cdpSession,
        page,
        target,
        recovered.backendNodeId,
        recovered.frameId ?? targetHint.frameId,
        targetHint.nth,
      );
      return clickResult;
    } catch {
      return cdpSession ? 'execution_error' : 'cdp_unavailable';
    } finally {
      if (cdpSession) {
        await cdpSession.detach().catch(() => {});
      }
    }
  }

  private async resolveClickPoint(cdpSession: CDPSession, backendNodeId: number): Promise<{ x: number; y: number } | null> {
    const boxModel = await cdpSession.send('DOM.getBoxModel', { backendNodeId }).catch(() => null);
    const contentQuad = boxModel?.model?.content;
    if (Array.isArray(contentQuad) && contentQuad.length >= 8) {
      const center = computeQuadCenter(contentQuad);
      if (center) {
        return center;
      }
    }

    const quads = await cdpSession.send('DOM.getContentQuads', { backendNodeId }).catch(() => null);
    const candidateQuads = quads?.quads;
    if (!Array.isArray(candidateQuads) || candidateQuads.length === 0) {
      return null;
    }

    let bestPoint: { x: number; y: number } | null = null;
    let bestArea = 0;
    for (const quad of candidateQuads) {
      if (!Array.isArray(quad) || quad.length < 8) {
        continue;
      }
      const center = computeQuadCenter(quad);
      if (!center) {
        continue;
      }
      const area = computeQuadArea(quad);
      if (area > bestArea) {
        bestArea = area;
        bestPoint = center;
      }
    }

    return bestPoint;
  }

  private async clickBackendNode(
    cdpSession: CDPSession,
    page: Page,
    selector: string,
    backendNodeId: number,
    frameId: string | undefined,
    nth: number | undefined,
  ): Promise<CdpClickResult> {
    const effectiveFrameId = frameId ?? await this.resolveFrameIdForBackendNode(cdpSession, backendNodeId);
    if (effectiveFrameId) {
      const frameCheck = await this.isTopFrameTarget(cdpSession, effectiveFrameId);
      if (!frameCheck) {
        return 'unsupported_frame';
      }
    }

    const scrolled = await cdpSession.send('DOM.scrollIntoViewIfNeeded', { backendNodeId }).catch(() => null);
    if (scrolled === null) {
      return 'stale_target';
    }

    const point = await this.resolveClickPoint(cdpSession, backendNodeId);
    if (!point) {
      return 'geometry_unavailable';
    }

    const isOccluded = await this.checkOcclusion(page, selector, point.x, point.y, nth);
    if (isOccluded) {
      const jsClicked = await this.tryJavascriptNodeClick(cdpSession, backendNodeId);
      return jsClicked ? 'ok' : 'occluded';
    }

    try {
      await sendCdpWithTimeout(cdpSession, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: point.x,
        y: point.y,
      }, CDP_EVENT_TIMEOUT_MS.move);
      await sendCdpWithTimeout(cdpSession, 'Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: point.x,
        y: point.y,
        button: 'left',
        clickCount: 1,
      }, CDP_EVENT_TIMEOUT_MS.down);
      await sendCdpWithTimeout(cdpSession, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: point.x,
        y: point.y,
        button: 'left',
        clickCount: 1,
      }, CDP_EVENT_TIMEOUT_MS.up);
      return 'ok';
    } catch (error) {
      if (isTimeoutError(error)) {
        return 'timeout';
      }
      return 'execution_error';
    }
  }

  private async isTopFrameTarget(cdpSession: CDPSession, frameId: string): Promise<boolean> {
    const frameTree = await cdpSession.send('Page.getFrameTree').catch(() => null);
    const rootFrameId = frameTree?.frameTree?.frame?.id;
    return typeof rootFrameId !== 'string' || frameId === rootFrameId;
  }

  private async resolveBackendNodeBySelector(
    cdpSession: CDPSession,
    selector: string,
    nth: number | undefined,
  ): Promise<{ backendNodeId: number; frameId?: string } | null> {
    let objectId: string | undefined;
    try {
      const nthIndex = Math.max(0, (nth ?? 1) - 1);
      const evaluated = await cdpSession.send('Runtime.evaluate', {
        expression: `(() => {
          try {
            const matches = document.querySelectorAll(${JSON.stringify(selector)});
            if (!matches || matches.length === 0) return null;
            return matches[${nthIndex}] || matches[0] || null;
          } catch {
            return null;
          }
        })()`,
        returnByValue: false,
      });
      objectId = evaluated.result?.objectId;
      if (!objectId) {
        return null;
      }

      const described = await cdpSession.send('DOM.describeNode', { objectId }).catch(() => null);
      const backendNodeId = described?.node?.backendNodeId;
      if (typeof backendNodeId !== 'number') {
        return null;
      }

      return {
        backendNodeId,
        frameId: typeof described?.node?.frameId === 'string' ? described.node.frameId : undefined,
      };
    } catch {
      return null;
    } finally {
      if (objectId) {
        await cdpSession.send('Runtime.releaseObject', { objectId }).catch(() => {});
      }
    }
  }

  private async resolveFrameIdForBackendNode(
    cdpSession: CDPSession,
    backendNodeId: number,
  ): Promise<string | undefined> {
    try {
      const described = await cdpSession.send('DOM.describeNode', { backendNodeId });
      return typeof described?.node?.frameId === 'string' ? described.node.frameId : undefined;
    } catch {
      return undefined;
    }
  }

  private async checkOcclusion(
    page: Page,
    selector: string,
    x: number,
    y: number,
    nth: number | undefined,
  ): Promise<boolean> {
    return page.evaluate(
      ({ targetSelector, clickX, clickY, ordinal }) => {
        try {
          const index = Math.max(0, (ordinal ?? 1) - 1);
          const candidates = document.querySelectorAll(targetSelector);
          const target = (candidates[index] ?? candidates[0] ?? null) as HTMLElement | null;
          if (!target) {
            return true;
          }
          const hit = document.elementFromPoint(clickX, clickY) as HTMLElement | null;
          if (!hit) {
            return false;
          }
          return hit !== target && !target.contains(hit);
        } catch {
          return false;
        }
      },
      { targetSelector: selector, clickX: x, clickY: y, ordinal: nth },
    ).catch(() => false);
  }

  private async tryJavascriptNodeClick(cdpSession: CDPSession, backendNodeId: number): Promise<boolean> {
    let objectId: string | undefined;
    try {
      const resolved = await cdpSession.send('DOM.resolveNode', { backendNodeId });
      objectId = resolved.object?.objectId;
      if (!objectId) {
        return false;
      }
      await cdpSession.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: 'function() { this.click(); }',
      });
      return true;
    } catch {
      return false;
    } finally {
      if (objectId) {
        await cdpSession.send('Runtime.releaseObject', { objectId }).catch(() => {});
      }
    }
  }

  private requirePage(): Page {
    if (!this.page) {
      throw new AdapterError('unsupported_runtime', 'DOM adapter requires a Playwright page', this.runtime);
    }
    return this.page;
  }
}

function computeQuadCenter(quad: number[]): { x: number; y: number } | null {
  if (quad.length < 8) {
    return null;
  }
  const x = (quad[0]! + quad[2]! + quad[4]! + quad[6]!) / 4;
  const y = (quad[1]! + quad[3]! + quad[5]! + quad[7]!) / 4;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x, y };
}

function computeQuadArea(quad: number[]): number {
  const xs = [quad[0]!, quad[2]!, quad[4]!, quad[6]!];
  const ys = [quad[1]!, quad[3]!, quad[5]!, quad[7]!];
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return 0;
  }
  return Math.max(0, width * height);
}

async function sendCdpWithTimeout(
  cdpSession: CDPSession,
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      cdpSession.send(method as any, params),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`CDP timeout for ${method}`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function isTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes('timeout');
}
