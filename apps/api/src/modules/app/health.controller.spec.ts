import { Test } from '@nestjs/testing';
import { HealthCheckService, type HealthIndicatorResult } from '@nestjs/terminus';
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
  };
  let controller: HealthController;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: health },
        { provide: RedisHealthIndicator, useValue: redisHealth },
      ],
    }).compile();

    controller = module.get(HealthController);
  });

  it('always includes the Redis indicator in the check', async () => {
    // Arrange & Act
    await controller.check();

    // Assert
    const indicators = health.check.mock.calls[0][0];
    expect(indicators).toHaveLength(1);
    await indicators[0]();
    expect(redisHealth.check).toHaveBeenCalledTimes(1);
  });

  it('returns the HealthCheckService result', async () => {
    // Arrange & Act
    const result = await controller.check();

    // Assert
    expect(result).toEqual({ status: 'ok' });
  });
});
