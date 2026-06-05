export const V2_OPERATIONAL_ERROR_CODES = [
  'invalid_runtime_mode',
  'target_not_found',
  'target_hidden',
  'target_disabled',
  'target_blocked',
  'target_not_editable',
  'target_not_clickable',
  'target_not_selectable',
  'stale_ref',
  'ambiguous_ref_resolution',
  'unselected_ref',
  'low_confidence_ref',
  'element_detached',
  'timeout',
  'navigation_interrupted',
  'navigation_blocked',
  'captcha_or_access_block',
  'trace_write_failed',
] as const;

export type V2OperationalErrorCode = (typeof V2_OPERATIONAL_ERROR_CODES)[number];

export class V2OperationalError extends Error {
  readonly code: V2OperationalErrorCode;
  readonly retryable: boolean;
  readonly diagnostics?: Record<string, unknown>;

  constructor(code: V2OperationalErrorCode, message: string, options: { retryable?: boolean; diagnostics?: Record<string, unknown> } = {}) {
    super(message);
    this.name = 'V2OperationalError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.diagnostics = options.diagnostics;
  }
}
