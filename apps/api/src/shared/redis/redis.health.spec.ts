import { HealthIndicatorService } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import { I18nService } from '@nestjs/i18n';
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
    REDIS_SOCKET_TIMEOUT_MS: 6000,
    REDIS_MAX_RETRIES_PER_REQUEST: 3,
    REDIS_SHUTDOWN_TIMEOUT_MS: 2000,
  },
}));

import { RedisHealthIndicator } from './redis.health.js';
import { RedisHealthProbe } from './redis.probe.js';
import type { RedisProbeOutcome } from './redis.probe.js';

function probeStub(outcome: RedisProbeOutcome) {
  return { probe: vi.fn<() => Promise<RedisProbeOutcome>>(async () => outcome) };
}

async function createIndicator(probe: ReturnType<typeof probeStub>) {
  const module = await Test.createTestingModule({
    providers: [
      RedisHealthIndicator,
      HealthIndicatorService,
      { provide: RedisHealthProbe, useValue: probe },
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
  it('reports up when the probe succeeds', async () => {
    // Arrange
    const probe = probeStub({ ok: true });
    const indicator = await createIndicator(probe);

    // Act
    const result = await indicator.check();

    // Assert
    expect(result).toEqual({ redis: { status: 'up' } });
    expect(probe.probe).toHaveBeenCalledTimes(1);
  });

  it('reports degraded — not down — when the probe fails, keeping the check non-fatal', async () => {
    // Arrange — the raw driver error must stay server-side (SEC-01 parity):
    // the unauthenticated health response carries only the generic message;
    // the failure is logged by the probe engine, never leaked to the response.
    const indicator = await createIndicator(probeStub({ ok: false, reason: 'Command timed out' }));

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
});

describe('RedisHealthIndicator.checkReady (strict readiness variant)', () => {
  it('reports up when the probe succeeds', async () => {
    // Arrange
    const indicator = await createIndicator(probeStub({ ok: true }));

    // Act
    const result = await indicator.checkReady();

    // Assert
    expect(result).toEqual({ redis: { status: 'up' } });
  });

  it('reports down — not degraded — when the probe fails, failing readiness with 503', async () => {
    // Arrange
    const indicator = await createIndicator(
      probeStub({ ok: false, reason: 'connect ECONNREFUSED 127.0.0.1:6379' }),
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
});
