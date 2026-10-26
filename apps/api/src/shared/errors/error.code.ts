// Application-wide error codes. Only codes actually needed by the current
// behavior live here; business features add their own codes as they arrive.
export enum ErrorCode {
  ApplicationError = 'APPLICATION_ERROR',
  BadRequest = 'BAD_REQUEST',
  InvalidRequestId = 'INVALID_REQUEST_ID',
  NotFound = 'NOT_FOUND',
}

// Stable fallback codes for built-in HTTP exceptions, keyed by status.
const STATUS_ERROR_CODES: ReadonlyMap<number, ErrorCode> = new Map([
  [400, ErrorCode.BadRequest],
  [404, ErrorCode.NotFound],
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
]);

export function problemTypeForErrorCode(code: ErrorCode): string | undefined {
  return ERROR_CODE_PROBLEM_TYPES.get(code);
}

// Stable, human-readable titles for application-specific Problem Types,
// keyed by the family's representative codes.
const ERROR_CODE_TITLES: ReadonlyMap<ErrorCode, string> = new Map([
  [ErrorCode.ApplicationError, 'Application Error'],
  [ErrorCode.InvalidRequestId, 'Invalid Request Id'],
]);

export function titleForErrorCode(code: ErrorCode): string | undefined {
  return ERROR_CODE_TITLES.get(code);
}
