import type { PlannerOutputStep } from '../planner/types';
import { isSupportedNavigationUrl } from '../runtime/navigationPolicy';
import type { V2ToolError, V2ToolResult } from '../runtime/types';
import type { V2ToolDispatchContext, V2ToolRuntime } from './types';

export class V2ToolDispatcher {
  constructor(private readonly runtime: V2ToolRuntime) {}

  async dispatch(step: PlannerOutputStep, _context: V2ToolDispatchContext): Promise<V2ToolResult> {
    switch (step.tool) {
      case 'click':
        return this.dispatchRefTool(step, 'click', ref => this.runtime.click(ref));
      case 'close':
        return this.dispatchRefTool(step, 'close', ref => this.runtime.click(ref));
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
