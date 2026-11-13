import type { I18nKey } from '@nestjs/i18n';

// Application-wide error codes. Only codes actually needed by the current
// behavior live here; business features add their own codes as they arrive.
export enum ErrorCode {
  ApplicationError = 'APPLICATION_ERROR',
  BadRequest = 'BAD_REQUEST',
  InvalidRequestId = 'INVALID_REQUEST_ID',
  NotFound = 'NOT_FOUND',
  OtpRateLimitExceeded = 'OTP_RATE_LIMIT_EXCEEDED',
  OtpVerificationFailed = 'OTP_VERIFICATION_FAILED',
  RateLimited = 'RATE_LIMITED',
  ServiceUnavailable = 'SERVICE_UNAVAILABLE',
}

// Stable fallback codes for built-in HTTP exceptions, keyed by status.
const STATUS_ERROR_CODES: ReadonlyMap<number, ErrorCode> = new Map([
  [400, ErrorCode.BadRequest],
  [404, ErrorCode.NotFound],
  [429, ErrorCode.RateLimited],
  [503, ErrorCode.ServiceUnavailable],
]);

export function errorCodeForStatus(status: number): ErrorCode {
  return STATUS_ERROR_CODES.get(status) ?? ErrorCode.ApplicationError;
}

// Family-level Problem Types. Application-specific failures share the
// application-error family; ordinary HTTP errors carry no application-specific
// type and use RFC 9457's `about:blank`.
export const APPLICATION_ERROR_PROBLEM_TYPE = '/problems/application-error';

const ERROR_CODE_PROBLEM_TYPES: ReadonlyMap<ErrorCode, string> = new Map([
  [ErrorCode.ApplicationError, APPLICATION_ERROR_PROBLEM_TYPE],
  [ErrorCode.InvalidRequestId, APPLICATION_ERROR_PROBLEM_TYPE],
  [ErrorCode.OtpRateLimitExceeded, APPLICATION_ERROR_PROBLEM_TYPE],
  [ErrorCode.OtpVerificationFailed, APPLICATION_ERROR_PROBLEM_TYPE],
  [ErrorCode.RateLimited, APPLICATION_ERROR_PROBLEM_TYPE],
  [ErrorCode.ServiceUnavailable, APPLICATION_ERROR_PROBLEM_TYPE],
]);

export function problemTypeForErrorCode(code: ErrorCode): string | undefined {
  return ERROR_CODE_PROBLEM_TYPES.get(code);
}

// Stable, human-readable titles for application-specific Problem Types,
// keyed by the family's representative codes.
const ERROR_CODE_TITLES: ReadonlyMap<ErrorCode, string> = new Map([
  [ErrorCode.ApplicationError, 'Application Error'],
  [ErrorCode.InvalidRequestId, 'Invalid Request Id'],
  [ErrorCode.OtpRateLimitExceeded, 'Too Many Requests'],
  [ErrorCode.OtpVerificationFailed, 'Verification Failed'],
  [ErrorCode.RateLimited, 'Too Many Requests'],
  [ErrorCode.ServiceUnavailable, 'Service Unavailable'],
]);

export function titleForErrorCode(code: ErrorCode): string | undefined {
  return ERROR_CODE_TITLES.get(code);
}

// Catalog keys for the translated titles (ADR-021). `buildProblemDetails`
// emits the English title above; the exception filter replaces it with the
// message for the request's locale. Codes without an application-specific
// title (`BadRequest`, `NotFound`) are absent by design: the filter then
// falls back to the status-based `errors.status.*` keys, which serve as the
// title source for those codes.
const ERROR_CODE_TITLE_KEYS: ReadonlyMap<ErrorCode, I18nKey> = new Map([
  [ErrorCode.ApplicationError, 'errors.titles.applicationError'],
  [ErrorCode.InvalidRequestId, 'errors.titles.invalidRequestId'],
  [ErrorCode.OtpRateLimitExceeded, 'errors.titles.otpRateLimitExceeded'],
  [ErrorCode.OtpVerificationFailed, 'errors.titles.otpVerificationFailed'],
  [ErrorCode.RateLimited, 'errors.titles.rateLimited'],
]);

export function titleKeyForErrorCode(code: ErrorCode): I18nKey | undefined {
  return ERROR_CODE_TITLE_KEYS.get(code);
}
