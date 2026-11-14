import { HealthIndicatorService } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import { I18nService } from '@nestjs/i18n';
import { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';

// Unit tests must not depend on ambient environment state, so the env
// validation layer is replaced with a fully valid environment.
vi.mock('#config/env/env.config.js', () => ({
  _env: {
    REDIS_URL: 'redis://localhost:6379',
    REDIS_USERNAME: undefined,
    REDIS_PASSWORD: undefined,
    REDIS_DB: undefined,
    REDIS_TLS: false,
    REDIS_CONNECT_TIMEOUT_MS: 10000,
    REDIS_COMMAND_TIMEOUT_MS: 5000,
    REDIS_MAX_RETRIES_PER_REQUEST: 3,
    REDIS_SHUTDOWN_TIMEOUT_MS: 2000,
  },
}));

import { REDIS_CLIENT } from './redis.constants.js';
import { RedisHealthIndicator } from './redis.health.js';
import { RedisService } from './redis.service.js';

async function createIndicator(ping: () => Promise<void>) {
  const module = await Test.createTestingModule({
    providers: [
      RedisHealthIndicator,
      HealthIndicatorService,
      { provide: RedisService, useValue: { ping } },
      { provide: REDIS_CLIENT, useValue: new Redis({ lazyConnect: true }) },
      {
        // Catalog-consistency tests guarantee the real message; the stub
        // keeps this spec independent of the loader.
        provide: I18nService,
        useValue: {
          t: vi.fn<(key: string) => string>((key) =>
            key === 'health.redisUnavailable' ? 'Redis is unavailable.' : key,
          ),
        },
      },
    ],
  }).compile();

  return module.get(RedisHealthIndicator);
}

describe('RedisHealthIndicator', () => {
  it('reports up when PING succeeds', async () => {
    // Arrange
    const indicator = await createIndicator(vi.fn().mockResolvedValue(undefined));

    // Act
    const result = await indicator.check();

    // Assert
    expect(result).toEqual({ redis: { status: 'up' } });
  });

  it('reports degraded — not down — when PING fails, keeping the check non-fatal', async () => {
    // Arrange — the raw driver error must stay server-side (SEC-01 parity):
    // the unauthenticated health response carries only the generic message.
    const indicator = await createIndicator(
      vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:6379')),
    );

    // Act
    const result = await indicator.check();

    // Assert
    expect(result).toEqual({
      redis: {
        status: 'degraded',
        message: 'Redis is unavailable.',
      },
    });
  });

  it('degrades with a generic message for non-error rejections', async () => {
    // Arrange
    const indicator = await createIndicator(vi.fn().mockRejectedValue('boom'));

    // Act
    const result = await indicator.check();

    // Assert
    expect(result).toEqual({ redis: { status: 'degraded', message: 'Redis is unavailable.' } });
  });
});

describe('RedisHealthIndicator.checkReady (strict readiness variant)', () => {
  it('reports up when PING succeeds', async () => {
    // Arrange
    const indicator = await createIndicator(vi.fn().mockResolvedValue(undefined));

    // Act
    const result = await indicator.checkReady();

    // Assert
    expect(result).toEqual({ redis: { status: 'up' } });
  });

  it('reports down — not degraded — when PING fails, failing readiness with 503', async () => {
    // Arrange
    const indicator = await createIndicator(
      vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:6379')),
    );

    // Act
    const result = await indicator.checkReady();

    // Assert
    expect(result).toEqual({
      redis: {
        status: 'down',
        message: 'Redis is unavailable.',
      },
    });
  });

  it('reports down with the localized fallback for non-error rejections', async () => {
    // Arrange
    const indicator = await createIndicator(vi.fn().mockRejectedValue('boom'));

    // Act
    const result = await indicator.checkReady();

    // Assert
    expect(result).toEqual({ redis: { status: 'down', message: 'Redis is unavailable.' } });
  });
});
