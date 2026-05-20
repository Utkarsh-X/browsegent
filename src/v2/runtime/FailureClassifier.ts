import type { OperationalProjection } from '../brain1/projectionTypes';
import type { V2ToolError, V2ToolResult } from './types';
import { V2OperationalError, type V2OperationalErrorCode } from './errors';

export type FailureEvidenceKind =
  | V2OperationalErrorCode
  | 'empty_projection'
  | 'environment_block'
  | 'unknown_failure';

export type FailureEvidenceCategory =
  | 'target'
  | 'continuity'
  | 'timing'
  | 'navigation'
  | 'projection'
  | 'environment'
  | 'unknown';

export interface FailureClassificationContext {
  observationId?: string;
  projection?: OperationalProjection;
  targetRef?: string;
  source?: string;
}

export interface FailureEvidence {
  failureId: string;
  kind: FailureEvidenceKind;
  category: FailureEvidenceCategory;
  severity: 'info' | 'warning' | 'critical';
  persistence: 'transient' | 'persistent' | 'unknown';
  retryable: boolean;
  message: string;
  source: string;
  observationId?: string;
  targetRef?: string;
  signals: string[];
}

export class FailureClassifier {
  classify(input?: V2ToolResult | V2ToolError | V2OperationalError | Error, context: FailureClassificationContext = {}): FailureEvidence {
    const environmentSignal = context.projection ? detectEnvironmentBlock(context.projection) : undefined;
    if (environmentSignal) {
      return createFailureEvidence('environment_block', {
        context,
        retryable: false,
        source: context.source ?? 'projection',
        message: 'Environment block evidence detected from page text.',
        signals: [environmentSignal],
      });
    }

    if (!input && context.projection?.stats.interactionCount === 0) {
      return createFailureEvidence('empty_projection', {
        context,
        retryable: false,
        source: context.source ?? 'projection',
        message: 'No actionable refs were present in the current projection.',
        signals: ['projection:empty_interactions'],
      });
    }

    const toolResult = isToolResult(input) ? input : undefined;
    const error = extractError(input);
    const kind = toFailureKind(error?.code);

    return createFailureEvidence(kind, {
      context: {
        ...context,
        targetRef: context.targetRef ?? toolResult?.targetRef,
      },
      retryable: error?.retryable ?? false,
      source: context.source ?? (toolResult ? 'tool_result' : 'runtime_error'),
      message: messageFor(kind),
      signals: [`error:${kind}`],
    });
  }
}

function createFailureEvidence(
  kind: FailureEvidenceKind,
  input: {
    context: FailureClassificationContext;
    retryable: boolean;
    source: string;
    message: string;
    signals: string[];
  },
): FailureEvidence {
  return {
    failureId: `failure_${kind}_${safeIdPart(input.context.observationId ?? input.context.targetRef ?? 'unknown')}`,
    kind,
    category: categoryFor(kind),
    severity: severityFor(kind),
    persistence: persistenceFor(kind, input.retryable),
    retryable: input.retryable,
    message: input.message,
    source: input.source,
    observationId: input.context.observationId,
    targetRef: input.context.targetRef,
    signals: input.signals,
  };
}

function extractError(input: V2ToolResult | V2ToolError | V2OperationalError | Error | undefined): V2ToolError | undefined {
  if (!input) return undefined;
  if (isToolResult(input)) return input.error;
  if (isToolError(input)) return input;
  if (input instanceof V2OperationalError) {
    return {
      code: input.code,
      message: input.message,
      retryable: input.retryable,
    };
  }

  return undefined;
}

function isToolResult(value: unknown): value is V2ToolResult {
  return typeof value === 'object'
    && value !== null
    && 'success' in value
    && 'kind' in value
    && 'traceStepId' in value;
}

function isToolError(value: unknown): value is V2ToolError {
  return typeof value === 'object'
    && value !== null
    && 'code' in value
    && 'message' in value
    && 'retryable' in value;
}

function toFailureKind(code: string | undefined): FailureEvidenceKind {
  switch (code) {
    case 'invalid_runtime_mode':
    case 'target_not_found':
    case 'target_hidden':
    case 'target_disabled':
    case 'target_blocked':
    case 'stale_ref':
    case 'low_confidence_ref':
    case 'timeout':
    case 'navigation_interrupted':
    case 'trace_write_failed':
      return code;
    default:
      return 'unknown_failure';
  }
}

function detectEnvironmentBlock(projection: OperationalProjection): string | undefined {
  const text = [
    projection.title,
    ...projection.readables.map(item => `${item.name ?? ''} ${item.text ?? ''}`),
    ...projection.warnings.map(warning => warning.message),
  ].join(' ').toLowerCase();

  if (text.includes('captcha')) return 'environment_text:captcha';
  if (text.includes('verification required')) return 'environment_text:verification';
  if (text.includes('security check')) return 'environment_text:security_check';
  if (text.includes('access denied')) return 'environment_text:access_denied';

  return undefined;
}

function categoryFor(kind: FailureEvidenceKind): FailureEvidenceCategory {
  switch (kind) {
    case 'target_not_found':
    case 'target_hidden':
    case 'target_disabled':
    case 'target_blocked':
      return 'target';
    case 'stale_ref':
    case 'low_confidence_ref':
      return 'continuity';
    case 'timeout':
      return 'timing';
    case 'navigation_interrupted':
      return 'navigation';
    case 'empty_projection':
      return 'projection';
    case 'environment_block':
      return 'environment';
    default:
      return 'unknown';
  }
}

function severityFor(kind: FailureEvidenceKind): FailureEvidence['severity'] {
  if (kind === 'environment_block' || kind === 'empty_projection') return 'critical';
  if (kind === 'timeout' || kind === 'navigation_interrupted') return 'warning';
  return 'warning';
}

function persistenceFor(kind: FailureEvidenceKind, retryable: boolean): FailureEvidence['persistence'] {
  if (retryable || kind === 'timeout' || kind === 'navigation_interrupted') return 'transient';
  if (
    kind === 'target_hidden'
    || kind === 'target_disabled'
    || kind === 'target_blocked'
    || kind === 'empty_projection'
    || kind === 'environment_block'
  ) {
    return 'persistent';
  }
  return 'unknown';
}

function messageFor(kind: FailureEvidenceKind): string {
  switch (kind) {
    case 'target_hidden':
      return 'Target ref is hidden at execution time.';
    case 'target_disabled':
      return 'Target ref is disabled at execution time.';
    case 'target_blocked':
      return 'Target ref center point is blocked by another element.';
    case 'stale_ref':
      return 'Target ref is absent from the current observation.';
    case 'low_confidence_ref':
      return 'Target ref continuity confidence is below execution threshold.';
    case 'timeout':
      return 'Runtime action exceeded its bounded wait.';
    case 'navigation_interrupted':
      return 'Navigation was interrupted before bounded settle completed.';
    case 'target_not_found':
      return 'Target ref was not found in the current runtime state.';
    default:
      return 'Unclassified runtime failure evidence was recorded.';
  }
}

function safeIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]+/g, '_');
}
