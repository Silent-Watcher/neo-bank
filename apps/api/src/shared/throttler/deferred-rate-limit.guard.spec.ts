import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';

import { DEFERRED_RATE_LIMIT_KEY } from './deferred-rate-limit.decorator.js';
import { DeferredRateLimitGuard } from './deferred-rate-limit.guard.js';

// Unit tests for the defer decision itself (ADR-039): a deferred route is
// skipped by the global guard without any storage access; every other route
// takes the unchanged official enforcement path. The full throttling behavior
// (quota, blocks, headers) is inherited unchanged from RedisThrottlerGuard
// and covered by the rate-limit suites.

const storage = {
  increment: vi.fn<
    (
      key: string,
      ttl: number,
      limit: number,
      blockDuration: number,
      throttlerName: string,
    ) => Promise<{
      totalHits: number;
      timeToExpire: number;
      isBlocked: boolean;
      timeToBlockExpire: number;
    }>
  >(),
};
const reflector = {
  getAllAndOverride: vi.fn<(key: string, targets: unknown[]) => boolean | undefined>(),
};

function createContext(): ExecutionContext {
  return {
    getHandler: () => ({ name: 'requestChallenge' }),
    getClass: () => ({ name: 'EnrollmentsController' }),
    switchToHttp: () => ({
      getRequest: () => ({ ip: '198.51.100.7', headers: {} }),
      getResponse: () => ({ setHeader: vi.fn<(name: string, value: string | number) => void>() }),
    }),
  } as unknown as ExecutionContext;
}

let guard: DeferredRateLimitGuard;

beforeEach(async () => {
  vi.clearAllMocks();
  storage.increment.mockResolvedValue({
    totalHits: 1,
    timeToExpire: 120_000,
    isBlocked: false,
    timeToBlockExpire: 0,
  });
  guard = new DeferredRateLimitGuard(
    { throttlers: [{ name: 'short', limit: 2, ttl: 120_000 }] } as ThrottlerModuleOptions,
    storage as unknown as ThrottlerStorage,
    reflector as unknown as Reflector,
  );
  await guard.onModuleInit();
});

describe('DeferredRateLimitGuard', () => {
  it('skips a deferred route entirely without consuming quota', async () => {
    // Arrange
    reflector.getAllAndOverride.mockReturnValue(true);

    // Act
    const allowed = await guard.canActivate(createContext());

    // Assert
    expect(allowed).toBe(true);
    expect(storage.increment).not.toHaveBeenCalled();
  });

  it('enforces the official throttling path for a non-deferred route', async () => {
    // Arrange
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const context = createContext();

    // Act
    const allowed = await guard.canActivate(context);

    // Assert — the inherited official guard runs the storage increment once
    // (one configured policy); the official key generation is the sha256 of
    // the controller, handler, tracker, and policy name.
    expect(allowed).toBe(true);
    expect(storage.increment).toHaveBeenCalledTimes(1);
    const [key, , , , name] = storage.increment.mock.calls[0];
    expect(String(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(name).toBe('short');
  });

  it('consults the defer metadata on the handler and its controller class', () => {
    // Act
    guard.canActivate(createContext());

    // Assert
    const [key, targets] = reflector.getAllAndOverride.mock.calls[0];
    expect(key).toBe(DEFERRED_RATE_LIMIT_KEY);
    expect(targets).toHaveLength(2);
  });
});
