import { Test } from '@nestjs/testing';
import { HealthCheckService, type HealthIndicatorResult } from '@nestjs/terminus';
import { ServiceUnavailableException } from '@nestjs/common';
import { I18nService } from '@nestjs/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Unit tests must not depend on ambient environment state, so the env
// validation layer is replaced with a fully valid environment.
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
  },
}));

import { RedisHealthIndicator } from '#src/shared/redis/redis.health.js';
import { MemoryHealthIndicator } from '#src/shared/memory-protection/memory.health.indicator.js';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  const health = {
    check: vi
      .fn<
        (
          indicators: readonly (() => Promise<HealthIndicatorResult>)[],
        ) => Promise<{ status: string }>
      >()
      .mockResolvedValue({ status: 'ok' }),
  };
  const redisHealth = {
    check: vi.fn<() => Promise<HealthIndicatorResult>>().mockResolvedValue({
      redis: { status: 'up' },
    }),
    checkReady: vi.fn<() => Promise<HealthIndicatorResult>>().mockResolvedValue({
      redis: { status: 'up' },
    }),
  };
  const memoryHealth = {
    check: vi.fn<() => HealthIndicatorResult>().mockResolvedValue({
      memory: { status: 'up' },
    }),
  };
  const i18n = {
    t: vi.fn<(key: string) => string>((key) => (key === 'health.notReady' ? 'not ready' : key)),
  };
  let controller: HealthController;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: health },
        { provide: RedisHealthIndicator, useValue: redisHealth },
        { provide: MemoryHealthIndicator, useValue: memoryHealth },
        { provide: I18nService, useValue: i18n },
      ],
    }).compile();

    controller = module.get(HealthController);
  });

  describe('liveness (GET /health)', () => {
    it('includes only the Redis indicator — memory protection must not affect liveness', async () => {
      // Arrange & Act
      await controller.check();

      // Assert
      const indicators = health.check.mock.calls[0][0];
      expect(indicators).toHaveLength(1);
      await indicators[0]();
      expect(redisHealth.check).toHaveBeenCalledTimes(1);
      expect(memoryHealth.check).not.toHaveBeenCalled();
    });

    it('returns the HealthCheckService result', async () => {
      // Arrange & Act
      const result = await controller.check();

      // Assert
      expect(result).toEqual({ status: 'ok' });
    });
  });

  describe('readiness (GET /health/ready)', () => {
    it('includes the strict Redis indicator and the memory indicator', async () => {
      // Arrange & Act
      await controller.checkReady();

      // Assert
      const indicators = health.check.mock.calls[0][0];
      expect(indicators).toHaveLength(2);
      await indicators[0]();
      await indicators[1]();
      expect(redisHealth.checkReady).toHaveBeenCalledTimes(1);
      expect(redisHealth.check).not.toHaveBeenCalled();
      expect(memoryHealth.check).toHaveBeenCalledTimes(1);
    });

    it('rethrows a failed readiness check as a 503 with the localized detail', async () => {
      // Arrange
      health.check.mockRejectedValueOnce(new ServiceUnavailableException('aggregate'));

      // Act
      const caught = await controller.checkReady().then(
        () => null,
        (error: unknown) => error,
      );

      // Assert
      expect(caught).toBeInstanceOf(ServiceUnavailableException);
      expect((caught as ServiceUnavailableException).message).toBe('not ready');
      expect(i18n.t).toHaveBeenCalledWith('health.notReady');
    });

    it('rethrows unrelated errors unchanged', async () => {
      // Arrange
      health.check.mockRejectedValueOnce(new Error('boom'));

      // Act & Assert
      await expect(controller.checkReady()).rejects.toThrowError('boom');
    });
  });
});
