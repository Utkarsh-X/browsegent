import type { PlannerOutputStep, PlannerPressKey } from '../planner/types';
import { isSupportedNavigationUrl } from '../runtime/navigationPolicy';
import type { V2ToolError, V2ToolResult } from '../runtime/types';
import type { SeekIterationVerdict, V2ToolDispatchContext, V2ToolRuntime } from './types';

const SEEK_MAX_ITERATIONS = 8;

export class V2ToolDispatcher {
  constructor(private readonly runtime: V2ToolRuntime) {}

  async dispatch(step: PlannerOutputStep, context: V2ToolDispatchContext): Promise<V2ToolResult> {
    switch (step.tool) {
      case 'click':
        return this.dispatchRefTool(step, 'click', ref => this.runtime.click(ref));
      case 'close':
        return this.dispatchRefTool(step, 'close', ref => this.runtime.click(ref));
      case 'seek':
        return this.dispatchSeek(step, context);
      case 'type':
        if (!isNonEmptyString(step.ref)) {
          return failure(step.tool, 'missing_ref', 'Ref is required for this v2 tool.', step.ref);
        }
        if (!isNonEmptyString(step.text)) {
          return failure(step.tool, 'missing_text', 'Text is required for this v2 tool.', step.ref);
        }
        return this.runtime.type(step.ref, step.text);
      case 'navigate':
        if (!isNonEmptyString(step.url)) {
          return failure(step.tool, 'missing_url', 'URL is required for this v2 tool.');
        }
        if (!isSupportedNavigationUrl(step.url)) {
          return failure(step.tool, 'unsupported_url', 'Navigate URL uses an unsupported protocol.');
        }
        return this.runtime.navigate(step.url);
      case 'get':
        return this.dispatchRefTool(step, 'get', ref => this.runtime.get(ref));
      case 'inspect_region':
        return this.dispatchRefTool(step, 'inspect_region', ref => this.runtime.inspectRegion(ref));
      case 'search_page':
        if (!isNonEmptyString(step.pattern)) {
          return failure(step.tool, 'missing_pattern', 'Pattern is required for this v2 tool.');
        }
        return this.runtime.searchPage(step.pattern);
      case 'scroll':
        return this.runtime.scroll(step.direction);
      case 'wait':
        return this.runtime.waitForState({ pattern: step.pattern, timeout: step.timeout });
      case 'press':
        if (!isValidPressKey(step.key)) {
          return failure(step.tool, 'invalid_key', 'Press key must be Enter, Escape, Tab, ArrowDown, or ArrowUp.');
        }
        return this.runtime.press(step.key);
      case 'select':
        if (!isNonEmptyString(step.ref)) {
          return failure(step.tool, 'missing_ref', 'Ref is required for this v2 tool.', step.ref);
        }
        if (!isNonEmptyString(step.value)) {
          return failure(step.tool, 'missing_value', 'Value is required for this v2 tool.', step.ref);
        }
        return this.runtime.select(step.ref, step.value);
      case 'pick_option': {
        if (!isNonEmptyString(step.ref)) {
          return failure(step.tool, 'missing_ref', 'Ref is required for this v2 tool.', step.ref);
        }
        if (!isNonEmptyString(step.text)) {
          return failure(step.tool, 'missing_text', 'Text is required for this v2 tool.', step.ref);
        }
        if (typeof this.runtime.pickOption !== 'function') {
          return failure(step.tool, 'pick_option_unsupported', 'This runtime does not implement pick_option.', step.ref);
        }
        return this.runtime.pickOption(step.ref, step.text);
      }
      case 'submit_form': {
        if (!isNonEmptyString(step.ref)) {
          return failure(step.tool, 'missing_ref', 'Ref is required for this v2 tool.', step.ref);
        }
        // Refusal guard #1 (shared predicate): a focused, unsatisfied
        // requirement means the submit would be premature — steering, not a
        // failure to retry. The loop passes the predicate per episode.
        if (context.commitPhaseReady === false) {
          return failure(
            step.tool,
            'requirements_unmet',
            'Submit refused: GOAL PROGRESS still shows a focused unsatisfied requirement. Complete that requirement first (select dates/values), then submit.',
            step.ref,
          );
        }
        if (typeof this.runtime.submitForm !== 'function') {
          return failure(step.tool, 'submit_form_unsupported', 'This runtime does not implement submit_form.', step.ref);
        }
        return this.runtime.submitForm(step.ref);
      }
      default:
        return failure(String((step as { tool?: unknown }).tool ?? 'unknown'), 'unsupported_tool', 'Unsupported v2 runtime tool.');
    }
  }

  private dispatchRefTool(
    step: PlannerOutputStep,
    kind: string,
    run: (refId: string) => Promise<V2ToolResult>,
  ): Promise<V2ToolResult> | V2ToolResult {
    if (!isNonEmptyString(step.ref)) {
      return failure(kind, 'missing_ref', 'Ref is required for this v2 tool.', step.ref);
    }

    return run(step.ref);
  }

  /**
   * `seek` executes a bounded widget-pagination loop substrate-side: click the
   * navigation control, observe, and ask the caller-provided stop condition
   * whether the goal target is now reachable. The planner stays the decision
   * maker (it chose the control and can stop planning seeks); the substrate
   * removes the per-click planner-call tax for mechanical iteration. Honest
   * failure modes: click error, missing observation, stall (identical window
   * signature twice), or the iteration cap.
   */
  private async dispatchSeek(step: PlannerOutputStep, context: V2ToolDispatchContext): Promise<V2ToolResult> {
    if (!isNonEmptyString(step.ref)) {
      return failure('seek', 'missing_ref', 'Ref is required for this v2 tool.', step.ref);
    }
    if (!context.seekStop) {
      return failure('seek', 'seek_unsupported', 'No seek stop condition is available in this runtime.');
    }
    if (typeof this.runtime.observe !== 'function') {
      return failure('seek', 'observation_unavailable', 'The runtime cannot observe between seek iterations.');
    }

    const iterations: number[] = [];
    const reasons: string[] = [];
    let previousProgressKey: string | undefined;

    for (let iteration = 1; iteration <= SEEK_MAX_ITERATIONS; iteration += 1) {
      const clickResult = await this.runtime.click(step.ref);
      if (!clickResult.success) {
        return seekResult(false, clickResult.error?.code ?? 'seek_click_failed', iterations, reasons, clickResult.error);
      }

      const observation = await this.runtime.observe();
      if (!observation) {
        return seekResult(false, 'seek_observation_failed', iterations, reasons);
      }

      let verdict: SeekIterationVerdict;
      try {
        verdict = context.seekStop(observation);
      } catch (error) {
        return seekResult(false, 'seek_stop_condition_error', iterations, [...reasons, error instanceof Error ? error.message : String(error)]);
      }

      iterations.push(iteration);
      reasons.push(verdict.reason ?? 'unspecified');
      if (verdict.stop) {
        return seekResult(true, verdict.reason ?? 'target_reachable', iterations, reasons);
      }

      // The click produced no window change: the control is not advancing the
      // widget. One repeat is enough to stop honestly.
      if (verdict.progressKey !== undefined && verdict.progressKey === previousProgressKey) {
        return seekResult(false, 'seek_stalled', iterations, reasons);
      }
      previousProgressKey = verdict.progressKey;
    }

    return seekResult(false, 'seek_iteration_cap', iterations, reasons);
  }
}

function seekResult(
  success: boolean,
  stopReason: string,
  iterations: number[],
  reasons: string[],
  error?: V2ToolError,
): V2ToolResult {
  const result: V2ToolResult = {
    success,
    kind: 'seek',
    traceStepId: `seek_${stopReason}`,
    value: {
      iterations,
      stopReason,
      iterationCount: iterations.length,
    },
  };
  if (error) {
    result.error = error;
  }
  return result;
}

function failure(kind: string, code: string, message: string, targetRef?: string): V2ToolResult {
  const error: V2ToolError = {
    code,
    message,
    retryable: false,
  };

  return {
    success: false,
    kind,
    targetRef,
    error,
    traceStepId: `dispatcher_rejected_${kind}`,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidPressKey(value: unknown): value is PlannerPressKey {
  return value === 'Enter'
    || value === 'Escape'
    || value === 'Tab'
    || value === 'ArrowDown'
    || value === 'ArrowUp';
}
