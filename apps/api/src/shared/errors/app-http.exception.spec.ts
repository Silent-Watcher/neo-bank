import { HttpException, HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { ErrorCode } from './error.code.js';
import { AppHttpException } from './app-http.exception.js';

describe('AppHttpException', () => {
  it('stays inside the standard NestJS HTTP exception model', () => {
    const exception = new AppHttpException(
      ErrorCode.InvalidRequestId,
      'x-request-id header must be a valid UUIDv4.',
      HttpStatus.BAD_REQUEST,
    );

    expect(exception).toBeInstanceOf(HttpException);
    expect(exception.getStatus()).toBe(HttpStatus.BAD_REQUEST);
  });

  it('exposes the typed error code and detail', () => {
    const exception = new AppHttpException(
      ErrorCode.ApplicationError,
      'Something application-specific failed.',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );

    expect(exception.code).toBe(ErrorCode.ApplicationError);
    expect(exception.getResponse()).toEqual({
      code: ErrorCode.ApplicationError,
      detail: 'Something application-specific failed.',
    });
  });
});
