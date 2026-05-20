export const V2_OPERATIONAL_ERROR_CODES = [
  'invalid_runtime_mode',
  'target_not_found',
  'target_hidden',
  'target_disabled',
  'target_blocked',
  'stale_ref',
  'low_confidence_ref',
  'timeout',
  'navigation_interrupted',
  'trace_write_failed',
] as const;

export type V2OperationalErrorCode = (typeof V2_OPERATIONAL_ERROR_CODES)[number];

export class V2OperationalError extends Error {
  readonly code: V2OperationalErrorCode;
  readonly retryable: boolean;

  constructor(code: V2OperationalErrorCode, message: string, options: { retryable?: boolean } = {}) {
    super(message);
    this.name = 'V2OperationalError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}
