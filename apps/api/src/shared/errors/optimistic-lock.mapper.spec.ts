import { OptimisticLockError } from '@mikro-orm/core';
import { HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { AppHttpException } from './app-http.exception.js';
import { ErrorCode } from './error.code.js';
import { mapOptimisticLockError } from './optimistic-lock.mapper.js';

// Captures the thrown value so the assertions stay outside a catch block
// (the vitest no-conditional-expect rule) and the guard narrows the type
// without an assertion.
function captureThrow(thrower: () => never): unknown {
  try {
    thrower();
  } catch (caught) {
    return caught;
  }
  throw new Error('expected the call to throw');
}

describe('mapOptimisticLockError', () => {
  it('converts a MikroORM lock failure into the shared version conflict response', () => {
    // Arrange
    const error = OptimisticLockError.lockFailed('TestArticle');

    // Act
    const thrown = captureThrow(() => mapOptimisticLockError(error, 'The record was modified.'));

    // Assert
    if (!(thrown instanceof AppHttpException)) {
      throw new Error('expected AppHttpException');
    }
    expect(thrown.code).toBe(ErrorCode.VersionConflict);
    expect(thrown.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(thrown.getResponse()).toMatchObject({
      code: ErrorCode.VersionConflict,
      detail: 'The record was modified.',
    });
  });

  it('rethrows unrelated errors unchanged', () => {
    // Arrange
    const error = new Error('connection refused');

    // Act & Assert
    expect(() => mapOptimisticLockError(error, 'detail')).toThrow(error);
  });
});
