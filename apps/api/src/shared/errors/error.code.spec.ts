import { describe, expect, it } from 'vitest';

import {
  APPLICATION_ERROR_PROBLEM_TYPE,
  ErrorCode,
  errorCodeForStatus,
  problemTypeForErrorCode,
  titleForErrorCode,
} from './error.code.js';

describe('errorCodeForStatus', () => {
  it('maps known statuses to their centralized codes', () => {
    expect(errorCodeForStatus(400)).toBe(ErrorCode.BadRequest);
    expect(errorCodeForStatus(404)).toBe(ErrorCode.NotFound);
  });

  it('falls back to the application error code for unmapped statuses', () => {
    expect(errorCodeForStatus(401)).toBe(ErrorCode.ApplicationError);
    expect(errorCodeForStatus(409)).toBe(ErrorCode.ApplicationError);
    expect(errorCodeForStatus(500)).toBe(ErrorCode.ApplicationError);
  });
});

describe('problemTypeForErrorCode', () => {
  it('maps application-family codes to the application-error Problem Type', () => {
    expect(problemTypeForErrorCode(ErrorCode.ApplicationError)).toBe(
      APPLICATION_ERROR_PROBLEM_TYPE,
    );
    expect(problemTypeForErrorCode(ErrorCode.InvalidRequestId)).toBe(
      APPLICATION_ERROR_PROBLEM_TYPE,
    );
  });

  it('returns no type for ordinary HTTP error codes', () => {
    expect(problemTypeForErrorCode(ErrorCode.BadRequest)).toBeUndefined();
    expect(problemTypeForErrorCode(ErrorCode.NotFound)).toBeUndefined();
  });
});

describe('titleForErrorCode', () => {
  it('provides stable titles for application-family codes', () => {
    expect(titleForErrorCode(ErrorCode.ApplicationError)).toBe('Application Error');
    expect(titleForErrorCode(ErrorCode.InvalidRequestId)).toBe('Invalid Request Id');
  });

  it('provides no title for ordinary HTTP error codes', () => {
    expect(titleForErrorCode(ErrorCode.BadRequest)).toBeUndefined();
    expect(titleForErrorCode(ErrorCode.NotFound)).toBeUndefined();
  });
});
