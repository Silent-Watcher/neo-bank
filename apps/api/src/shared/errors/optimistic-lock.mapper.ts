import { HttpStatus } from '@nestjs/common';
import { OptimisticLockError } from '@mikro-orm/core';

import { AppHttpException } from './app-http.exception.js';
import { ErrorCode } from './error.code.js';

/**
 * Maps MikroORM's optimistic-locking failures to the application's version
 * conflict response (ADR-029): `ErrorCode.VersionConflict`, HTTP 409. The
 * detail is localized at the call site (the owning service, like every other
 * `AppHttpException` detail); the message distinguishes only the conflict,
 * never internal state. Any other error is rethrown unchanged so unrelated
 * failures keep their own handling.
 */
export function mapOptimisticLockError(error: unknown, detail: string): never {
  if (error instanceof OptimisticLockError) {
    throw new AppHttpException(ErrorCode.VersionConflict, detail, HttpStatus.CONFLICT);
  }
  throw error;
}
