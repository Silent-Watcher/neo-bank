import { ServiceUnavailableException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { I18nService } from '@nestjs/i18n';
import type { FastifyReply } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

// Unit tests must not depend on ambient environment state, so the env
// validation layer is replaced with a fully valid environment (the guard
// module chain imports the eagerly-validated env config).
vi.mock('#config/env/env.config.js', () => ({
  _env: {
    APP_ENV: 'test',
    HOST: '0.0.0.0',
    PORT: 3001,
    LOG_LEVEL: 'info',
    REDIS_URL: 'redis://localhost:6379',
    REDIS_USERNAME: '',
    REDIS_PASSWORD: '',
    REDIS_TLS: 'false',
    REDIS_CONNECT_TIMEOUT_MS: 10000,
    REDIS_COMMAND_TIMEOUT_MS: 5000,
    REDIS_MAX_RETRIES_PER_REQUEST: 3,
    REDIS_SHUTDOWN_TIMEOUT_MS: 2000,
    MEMORY_PROTECTION_ENABLED: 'true',
    MEMORY_PROTECTION_MAX_RSS_MB: 1024,
    MEMORY_PROTECTION_RECOVERY_RSS_MB: 768,
    MEMORY_PROTECTION_SAMPLE_INTERVAL_MS: 5000,
    MEMORY_PROTECTION_STABLE_SAMPLES: 3,
  },
}));

import { MemoryProtectionGuard } from './memory-protection.guard.js';
import { MemoryProtectionService } from './memory-protection.service.js';

function createContext(exempt: boolean | undefined, replyHeaders: Map<string, string>) {
  const reply = {
    header: vi.fn<(name: string, value: string) => FastifyReply>((name, value) => {
      replyHeaders.set(name, value);
      return reply;
    }),
  } as unknown as FastifyReply;
  const reflector = {
    getAllAndOverride: vi.fn<(key: string, targets: unknown[]) => boolean | undefined>(
      () => exempt,
    ),
  } as unknown as Reflector;

  return {
    context: {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getResponse: () => reply }),
    } as unknown as Parameters<MemoryProtectionGuard['canActivate']>[0],
    reflector,
  };
}

function createGuard(
  reflector: Reflector,
  isProtected: boolean,
  secondsUntilNextSample = 5,
): { guard: MemoryProtectionGuard; i18n: I18nService } {
  const memoryProtection = {
    isProtected: vi.fn<() => boolean>(() => isProtected),
    getSecondsUntilNextSample: vi.fn<() => number>(() => secondsUntilNextSample),
  } as unknown as MemoryProtectionService;
  const i18n = {
    t: vi.fn<(key: string) => string>((key) =>
      key === 'errors.details.serviceOverloaded' ? 'overloaded' : key,
    ),
  } as unknown as I18nService;

  return { guard: new MemoryProtectionGuard(reflector, memoryProtection, i18n), i18n };
}

/** Runs the guard and returns the thrown error, or null when admitted. */
function catchGuardResult(
  guard: MemoryProtectionGuard,
  context: Parameters<MemoryProtectionGuard['canActivate']>[0],
): unknown {
  try {
    guard.canActivate(context);
    return null;
  } catch (error) {
    return error;
  }
}

describe('MemoryProtectionGuard', () => {
  it('admits every request while the protection state is inactive', () => {
    // Arrange
    const { context, reflector } = createContext(undefined, new Map());
    const { guard } = createGuard(reflector, false);

    // Act
    const result = guard.canActivate(context);

    // Assert
    expect(result).toBe(true);
    expect(reflector.getAllAndOverride).not.toHaveBeenCalled();
  });

  it('admits exempt routes while the protection state is active', () => {
    // Arrange
    const { context, reflector } = createContext(true, new Map());
    const { guard } = createGuard(reflector, true);

    // Act
    const result = guard.canActivate(context);

    // Assert
    expect(result).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      'skipMemoryProtection',
      expect.any(Array),
    );
  });

  it('rejects non-exempt routes with 503, a Retry-After header, and a localized detail', () => {
    // Arrange
    const replyHeaders = new Map<string, string>();
    const { context, reflector } = createContext(undefined, replyHeaders);
    const { guard, i18n } = createGuard(reflector, true, 7);

    // Act
    const error = catchGuardResult(guard, context);

    // Assert
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).message).toBe('overloaded');
    expect(replyHeaders.get('Retry-After')).toBe('7');
    expect(i18n.t).toHaveBeenCalledWith('errors.details.serviceOverloaded');
  });
});
