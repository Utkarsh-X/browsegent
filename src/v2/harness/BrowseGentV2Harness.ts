import { V2OperationalError } from '../runtime/errors';
import { isSupportedNavigationUrl } from '../runtime/navigationPolicy';
import { RefService } from '../runtime/RefService';
import { StabilizationService } from '../runtime/StabilizationService';
import { TransitionService } from '../runtime/TransitionService';
import type { BrowserObservation, V2Ref, V2ToolError, V2ToolResult, V2ToolTargetSummary } from '../runtime/types';
import type { PlannerPressKey } from '../planner/types';
import { BrowserSession } from '../substrate/BrowserSession';
import { InputService } from '../substrate/InputService';
import { KeyboardService } from '../substrate/KeyboardService';
import { ObservationService } from '../substrate/ObservationService';
import { TraceStore } from '../trace/TraceStore';
import type { TraceArtifact, TraceManifest } from '../trace/types';
import type { FailureEvidence } from '../runtime/FailureClassifier';
import type { BrowseGentV2HarnessOptions } from './types';
import { buildRefResolutionAudit } from '../runtime/RefResolutionAudit';
import { shouldAttemptWeakenedRefSelfHeal } from '../runtime/RefSelfHealingPolicy';

export class BrowseGentV2Harness {
  private readonly session: BrowserSession;
  private readonly observer = new ObservationService();
  private readonly refService = new RefService();
  private readonly inputService = new InputService();
  private readonly keyboardService = new KeyboardService();
  private readonly stabilizationService = new StabilizationService();
  private readonly transitionService = new TransitionService();
  private readonly traceStore: TraceStore;
  private readonly sessionId: string;
  private generationId = 0;
  private current?: BrowserObservation;

  constructor(options: BrowseGentV2HarnessOptions = {}) {
    const runId = options.runId ?? `v2run_${Date.now()}`;
    this.sessionId = options.sessionId ?? `${runId}_session`;
    this.session = new BrowserSession({
      headed: options.headed ?? true,
      viewport: options.viewport,
    });
    this.traceStore = new TraceStore({
      runId,
      runtimeMode: options.runtimeMode ?? 'mvr',
      traceDir: options.traceDir ?? 'logs/v2-runs',
    });
  }

  async open(url: string): Promise<BrowserObservation> {
    this.generationId += 1;
    await this.session.open(url);
    await this.stabilizationService.waitForSettledState(this.session.currentPage());
    return this.captureCurrentObservation();
  }

  async observe(): Promise<BrowserObservation> {
    this.assertOpened();
    return this.captureCurrentObservation();
  }

  async click(refId: string): Promise<V2ToolResult> {
    return this.executeMutation('click', refId, async (ref) => this.inputService.click(ref, this.session.currentPage()));
  }

  async type(refId: string, text: string): Promise<V2ToolResult<{ inputValue: string }>> {
    return this.executeMutation('type', refId, async (ref) => this.inputService.type(ref, text, this.session.currentPage()));
  }

  async select(refId: string, value: string): Promise<V2ToolResult<{ value: string; selectedText: string }>> {
    return this.executeMutation('select', refId, async (ref) => this.inputService.select(ref, value, this.session.currentPage()));
  }

  async press(key: PlannerPressKey): Promise<V2ToolResult<{ key: PlannerPressKey }>> {
    const before = this.assertOpened();
    const stepId = this.traceStore.recordActionStart({
      kind: 'press',
      beforeObservationId: before.observationId,
      input: { key },
    });

    try {
      const execution = await this.keyboardService.press(key, this.session.currentPage());
      await this.stabilizationService.waitForSettledState(this.session.currentPage());
      const after = await this.captureCurrentObservation();
      const evidence = this.transitionService.compare(before, after);
      const result: V2ToolResult<{ key: PlannerPressKey }> = {
        success: true,
        kind: 'press',
        value: execution.value,
        evidence,
        traceStepId: stepId,
      };

      this.traceStore.recordActionEnd(stepId, result, {
        afterObservationId: after.observationId,
      });
      return result;
    } catch (error) {
      const result = this.failureResult<{ key: PlannerPressKey }>('press', undefined, stepId, mapExecutionError(error));
      try {
        await this.stabilizationService.waitForSettledState(this.session.currentPage());
        const after = await this.captureCurrentObservation();
        result.evidence = this.transitionService.compare(before, after);
        this.traceStore.recordActionEnd(stepId, result, {
          afterObservationId: after.observationId,
        });
      } catch {
        this.traceStore.recordActionEnd(stepId, result);
      }
      return result;
    }
  }

  async navigate(url: string): Promise<V2ToolResult<{ url: string }>> {
    const before = this.assertOpened();
    const stepId = this.traceStore.recordActionStart({
      kind: 'navigate',
      beforeObservationId: before.observationId,
      input: { url: compactText(url, 2_000) },
    });

    if (!isSupportedNavigationUrl(url)) {
      const result = this.failureResult<{ url: string }>('navigate', undefined, stepId, {
        code: 'unsupported_url',
        message: 'Navigate URL uses an unsupported protocol.',
        retryable: false,
      });
      this.traceStore.recordActionEnd(stepId, result);
      return result;
    }

    try {
      this.generationId += 1;
      await this.session.open(url);
      await this.stabilizationService.waitForSettledState(this.session.currentPage());
      const after = await this.captureCurrentObservation();
      const evidence = this.transitionService.compare(before, after);
      const result: V2ToolResult<{ url: string }> = {
        success: true,
        kind: 'navigate',
        value: { url },
        evidence,
        traceStepId: stepId,
      };

      this.traceStore.recordActionEnd(stepId, result, {
        afterObservationId: after.observationId,
      });
      return result;
    } catch (error) {
      const result = this.failureResult<{ url: string }>('navigate', undefined, stepId, mapExecutionError(error));
      this.traceStore.recordActionEnd(stepId, result);
      return result;
    }
  }

  async get(refId: string): Promise<V2ToolResult<{ text: string; value?: string }>> {
    return this.executeRefRead('get', refId, (ref) => ({
      text: compactText(ref.name || ref.text || ''),
      value: ref.role === 'textbox' && ref.name ? compactText(ref.name) : undefined,
    }));
  }

  async inspectRegion(refId: string): Promise<V2ToolResult<{ refId: string; text: string; nearbyRefs: string[] }>> {
    return this.executeRefRead('inspect_region', refId, (ref, observation) => ({
      refId: ref.refId,
      text: compactText([ref.name, ref.text].filter(Boolean).join(' ')),
      nearbyRefs: observation.refs
        .filter(candidate => candidate.refId !== ref.refId && candidate.visibility !== 'hidden')
        .slice(0, 5)
        .map(candidate => candidate.refId),
    }));
  }

  async searchPage(pattern: string): Promise<V2ToolResult<{ matches: number; preview: string[] }>> {
    const before = this.assertOpened();
    const stepId = this.traceStore.recordActionStart({
      kind: 'search_page',
      beforeObservationId: before.observationId,
      input: { pattern },
    });

    try {
      const bodyText = await this.session.currentPage().evaluate(() => document.body?.innerText ?? '');
      const lowerPattern = pattern.toLowerCase();
      const lines = bodyText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const preview = lines
        .filter(line => line.toLowerCase().includes(lowerPattern))
        .slice(0, 3)
        .map(line => compactText(line, 240));
      const matches = countLiteralMatches(bodyText, pattern);
      const result: V2ToolResult<{ matches: number; preview: string[] }> = {
        success: true,
        kind: 'search_page',
        value: { matches, preview },
        traceStepId: stepId,
      };

      this.traceStore.recordActionEnd(stepId, result);
      return result;
    } catch (error) {
      const result = this.failureResult<{ matches: number; preview: string[] }>('search_page', undefined, stepId, mapExecutionError(error));
      this.traceStore.recordActionEnd(stepId, result);
      return result;
    }
  }

  async scroll(direction: 'down' | 'up' = 'down'): Promise<V2ToolResult<{ direction: 'down' | 'up' }>> {
    const before = this.assertOpened();
    const stepId = this.traceStore.recordActionStart({
      kind: 'scroll',
      beforeObservationId: before.observationId,
      input: { direction },
    });

    try {
      const distance = direction === 'up' ? -600 : 600;
      await this.session.currentPage().evaluate((scrollDistance) => window.scrollBy(0, scrollDistance), distance);
      await this.stabilizationService.waitForSettledState(this.session.currentPage());
      const after = await this.captureCurrentObservation();
      const evidence = this.transitionService.compare(before, after);
      const result: V2ToolResult<{ direction: 'down' | 'up' }> = {
        success: true,
        kind: 'scroll',
        value: { direction },
        evidence,
        traceStepId: stepId,
      };

      this.traceStore.recordActionEnd(stepId, result, {
        afterObservationId: after.observationId,
      });
      return result;
    } catch (error) {
      const result = this.failureResult<{ direction: 'down' | 'up' }>('scroll', undefined, stepId, mapExecutionError(error));
      this.traceStore.recordActionEnd(stepId, result);
      return result;
    }
  }

  async waitForState(input: { pattern?: string; timeout?: number }): Promise<V2ToolResult<{ matched: boolean }>> {
    const before = this.assertOpened();
    const timeout = Math.max(0, Math.min(input.timeout ?? 500, 5_000));
    const traceInput: { pattern?: string; timeout: number } = { timeout };
    if (input.pattern !== undefined) {
      traceInput.pattern = input.pattern;
    }
    const stepId = this.traceStore.recordActionStart({
      kind: 'wait',
      beforeObservationId: before.observationId,
      input: traceInput,
    });

    try {
      let matched = false;
      if (input.pattern) {
        const pattern = input.pattern;
        matched = await this.session.currentPage().waitForFunction(
          expected => document.body?.innerText.toLowerCase().includes(String(expected).toLowerCase()) ?? false,
          pattern,
          { timeout },
        ).then(() => true).catch(() => false);
      } else if (timeout > 0) {
        await this.session.currentPage().waitForTimeout(timeout);
      }

      const after = await this.captureCurrentObservation();
      const evidence = this.transitionService.compare(before, after);
      const result: V2ToolResult<{ matched: boolean }> = {
        success: true,
        kind: 'wait',
        value: { matched },
        evidence,
        traceStepId: stepId,
      };

      this.traceStore.recordActionEnd(stepId, result, {
        afterObservationId: after.observationId,
      });
      return result;
    } catch (error) {
      const result = this.failureResult<{ matched: boolean }>('wait', undefined, stepId, mapExecutionError(error));
      this.traceStore.recordActionEnd(stepId, result);
      return result;
    }
  }

  async flushTrace(): Promise<TraceManifest> {
    return this.traceStore.flush();
  }

  recordPlannerInput(episodeId: string, input: unknown): TraceArtifact {
    return this.traceStore.recordPlannerInput(episodeId, input);
  }

  recordCompactPlannerInput(episodeId: string, input: unknown): TraceArtifact {
    return this.traceStore.recordCompactPlannerInput(episodeId, input);
  }

  recordPlannerOutput(episodeId: string, output: unknown): TraceArtifact {
    return this.traceStore.recordPlannerOutput(episodeId, output);
  }

  recordFailureEvidence(failure: FailureEvidence): TraceArtifact {
    return this.traceStore.recordFailureEvidence(failure);
  }

  recordCompactPlannerView(episodeId: string, payload: unknown): TraceArtifact {
    return this.traceStore.recordCompactPlannerView(episodeId, payload);
  }

  async close(): Promise<void> {
    await this.session.close();
  }

  private async executeMutation<TValue>(
    kind: 'click' | 'type' | 'select',
    refId: string,
    run: (ref: NonNullable<ReturnType<RefService['resolve']>['ref']>) => Promise<{ value?: TValue }>,
  ): Promise<V2ToolResult<TValue>> {
    const before = this.assertOpened();
    const stepId = this.traceStore.recordActionStart({
      kind,
      targetRef: refId,
      beforeObservationId: before.observationId,
    });
    const resolution = this.refService.resolve(refId, before);
    const decision = shouldAttemptWeakenedRefSelfHeal(kind, resolution.ref);

    const ref = resolution.ref;
    if (!ref || (resolution.state !== 'live' && !decision.allow)) {
      const auditId = this.recordRefResolutionAudit({
        observation: before,
        targetRef: refId,
        actionKind: kind,
        failureCode: resolution.state === 'weakened' ? 'low_confidence_ref' : 'stale_ref',
        diagnostics: {
          resolutionState: resolution.state,
          resolutionReason: resolution.reason,
          confidence: resolution.confidence,
          selfHealDecision: decision.reason,
        },
        selfHeal: {
          attempted: decision.allow,
          result: 'not_attempted',
          reason: decision.reason,
        },
      });
      const error = mapResolutionError(resolution.state, {
        refResolutionAuditId: auditId,
        resolutionState: resolution.state,
        resolutionReason: resolution.reason,
        confidence: resolution.confidence,
      });
      const result = this.failureResult<TValue>(kind, refId, stepId, error);
      this.traceStore.recordActionEnd(stepId, result);
      return result;
    }

    try {
      const execution = await run(ref);
      await this.stabilizationService.waitForSettledState(this.session.currentPage());
      const after = await this.captureCurrentObservation();
      const evidence = this.transitionService.compare(before, after);
      if (resolution.state !== 'live' && decision.allow) {
        this.recordRefResolutionAudit({
          observation: before,
          targetRef: refId,
          actionKind: kind,
          selfHeal: {
            attempted: true,
            result: 'succeeded',
            reason: decision.reason,
          }
        });
      }
      const result: V2ToolResult<TValue> = {
        success: true,
        kind,
        targetRef: refId,
        target: summarizeToolTarget(ref),
        value: execution.value,
        evidence,
        traceStepId: stepId,
      };

      this.traceStore.recordActionEnd(stepId, result, {
        afterObservationId: after.observationId,
      });
      return result;
    } catch (error) {
      const result = this.failureResult<TValue>(kind, refId, stepId, mapExecutionError(error));
      if (result.error && refId) {
        const auditId = this.recordRefResolutionAudit({
          observation: before,
          targetRef: refId,
          actionKind: kind,
          failureCode: result.error.code,
          diagnostics: result.error.diagnostics,
          ...(resolution.state !== 'live' && decision.allow ? {
            selfHeal: {
              attempted: true,
              result: 'failed',
              reason: decision.reason,
            }
          } : {})
        });
        result.error.diagnostics = {
          ...(result.error.diagnostics ?? {}),
          refResolutionAuditId: auditId,
        };
      }
      try {
        await this.stabilizationService.waitForSettledState(this.session.currentPage());
        const after = await this.captureCurrentObservation();
        result.evidence = this.transitionService.compare(before, after);
        this.traceStore.recordActionEnd(stepId, result, {
          afterObservationId: after.observationId,
        });
      } catch {
        this.traceStore.recordActionEnd(stepId, result);
      }
      return result;
    }
  }

  private executeRefRead<TValue>(
    kind: string,
    refId: string,
    read: (ref: V2Ref, observation: BrowserObservation) => TValue,
  ): V2ToolResult<TValue> {
    const before = this.assertOpened();
    const stepId = this.traceStore.recordActionStart({
      kind,
      targetRef: refId,
      beforeObservationId: before.observationId,
    });
    const resolution = this.refService.resolve(refId, before);
    const decision = shouldAttemptWeakenedRefSelfHeal(kind, resolution.ref);

    const ref = resolution.ref;
    if (!ref || (resolution.state !== 'live' && !decision.allow)) {
      const auditId = this.recordRefResolutionAudit({
        observation: before,
        targetRef: refId,
        actionKind: kind,
        failureCode: resolution.state === 'weakened' ? 'low_confidence_ref' : 'stale_ref',
        diagnostics: {
          resolutionState: resolution.state,
          resolutionReason: resolution.reason,
          confidence: resolution.confidence,
          selfHealDecision: decision.reason,
        },
        selfHeal: {
          attempted: decision.allow,
          result: 'not_attempted',
          reason: decision.reason,
        },
      });
      const error = mapResolutionError(resolution.state, {
        refResolutionAuditId: auditId,
        resolutionState: resolution.state,
        resolutionReason: resolution.reason,
        confidence: resolution.confidence,
      });
      const result = this.failureResult<TValue>(kind, refId, stepId, error);
      this.traceStore.recordActionEnd(stepId, result);
      return result;
    }

    try {
      const result: V2ToolResult<TValue> = {
        success: true,
        kind,
        targetRef: refId,
        target: summarizeToolTarget(ref),
        value: read(ref, before),
        traceStepId: stepId,
      };

      this.traceStore.recordActionEnd(stepId, result);
      return result;
    } catch (error) {
      const result = this.failureResult<TValue>(kind, refId, stepId, mapExecutionError(error));
      if (result.error && refId) {
        const auditId = this.recordRefResolutionAudit({
          observation: before,
          targetRef: refId,
          actionKind: kind,
          failureCode: result.error.code,
          diagnostics: result.error.diagnostics,
          ...(resolution.state !== 'live' && decision.allow ? {
            selfHeal: {
              attempted: true,
              result: 'failed',
              reason: decision.reason,
            }
          } : {})
        });
        result.error.diagnostics = {
          ...(result.error.diagnostics ?? {}),
          refResolutionAuditId: auditId,
        };
      }
      this.traceStore.recordActionEnd(stepId, result);
      return result;
    }
  }

  private async captureCurrentObservation(): Promise<BrowserObservation> {
    const observation = await this.observer.capture({
      sessionId: this.sessionId,
      generationId: this.generationId,
      page: this.session.currentPage(),
    });
    const assigned = this.refService.assign(observation);
    this.current = assigned;
    this.traceStore.recordObservation(assigned);
    return assigned;
  }

  private assertOpened(): BrowserObservation {
    if (!this.current) {
      throw new V2OperationalError('target_not_found', 'No active v2 observation is available.', { retryable: false });
    }
    return this.current;
  }

  private failureResult<TValue>(
    kind: string,
    targetRef: string | undefined,
    traceStepId: string,
    error: V2ToolError,
  ): V2ToolResult<TValue> {
    return {
      success: false,
      kind,
      targetRef,
      error,
      traceStepId,
    };
  }

  private recordRefResolutionAudit(input: {
    observation: BrowserObservation;
    targetRef: string;
    actionKind: string;
    failureCode?: string;
    diagnostics?: Record<string, unknown>;
    selfHeal?: {
      attempted: boolean;
      result: 'not_attempted' | 'succeeded' | 'failed';
      reason: string;
    };
  }): string {
    const audit = buildRefResolutionAudit(input);
    this.traceStore.recordRefResolutionAudit(audit.auditId, audit);
    return audit.auditId;
  }
}

function compactText(text: string, maxLength = 500): string {
  const compacted = text.replace(/\s+/g, ' ').trim();
  return compacted.length > maxLength ? `${compacted.slice(0, maxLength - 3)}...` : compacted;
}

function summarizeToolTarget(ref: V2Ref): V2ToolTargetSummary {
  const summary: V2ToolTargetSummary = {
    refId: ref.refId,
  };

  assignIfPresent(summary, 'role', ref.role);
  assignIfPresent(summary, 'name', ref.name);
  assignIfPresent(summary, 'text', ref.text);
  return summary;
}

function assignIfPresent<TKey extends 'role' | 'name' | 'text'>(
  target: V2ToolTargetSummary,
  key: TKey,
  value: string | undefined,
): void {
  const compacted = value ? compactText(value, 240) : '';
  if (compacted) {
    target[key] = compacted;
  }
}

function countLiteralMatches(text: string, pattern: string): number {
  if (!pattern) {
    return 0;
  }

  const normalizedText = text.toLowerCase();
  const normalizedPattern = pattern.toLowerCase();
  let count = 0;
  let offset = 0;

  while (offset < normalizedText.length) {
    const index = normalizedText.indexOf(normalizedPattern, offset);
    if (index === -1) {
      break;
    }
    count += 1;
    offset = index + normalizedPattern.length;
  }

  return count;
}

function mapResolutionError(state: string, diagnostics?: Record<string, unknown>): V2ToolError {
  if (state === 'weakened') {
    return {
      code: 'low_confidence_ref',
      message: 'Ref continuity confidence is below the execution threshold.',
      retryable: false,
      diagnostics,
    };
  }

  return {
    code: 'stale_ref',
    message: 'Ref is not live in the current observation.',
    retryable: false,
    diagnostics,
  };
}

function mapExecutionError(error: unknown): V2ToolError {
  if (error instanceof V2OperationalError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      diagnostics: error.diagnostics,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    code: 'timeout',
    message,
    retryable: true,
  };
}
