import { HealthIndicatorService } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import { I18nService } from '@nestjs/i18n';
import { describe, expect, it, vi } from 'vitest';

import { DatabaseHealthIndicator } from './database.health.js';
import { DatabaseHealthProbe } from './database.probe.js';
import type { DatabaseProbeOutcome } from './database.probe.js';

// Unit tests must not depend on ambient environment state, so the env
// validation layer is replaced with a fully valid environment.
vi.mock('#config/env/env.config.js', () => ({
  _env: {
    DATABASE_URL: 'postgres://localhost:5432/neo_bank',
  },
}));

function probeStub(outcome: DatabaseProbeOutcome) {
  return { probe: vi.fn(async () => outcome) };
}

async function createIndicator(probe: ReturnType<typeof probeStub>) {
  const module = await Test.createTestingModule({
    providers: [
      DatabaseHealthIndicator,
      HealthIndicatorService,
      { provide: DatabaseHealthProbe, useValue: probe },
      {
        // Catalog-consistency tests guarantee the real message; the stub
        // keeps this spec independent of the loader.
        provide: I18nService,
        useValue: {
          t: vi.fn<(key: string) => string>((key) =>
            key === 'health.databaseUnavailable' ? 'PostgreSQL is unavailable.' : key,
          ),
        },
      },
    ],
  }).compile();

  return module.get(DatabaseHealthIndicator);
}

describe('DatabaseHealthIndicator', () => {
  it('reports up when the probe succeeds', async () => {
    // Arrange
    const probe = probeStub({ ok: true });
    const indicator = await createIndicator(probe);

    // Act
    const result = await indicator.check();

    // Assert
    expect(result).toEqual({ postgres: { status: 'up' } });
    expect(probe.probe).toHaveBeenCalledTimes(1);
  });

  it('reports degraded — not down — when the probe fails, keeping the check non-fatal', async () => {
    // Arrange — the raw driver reason must stay server-side (SEC-01): the
    // unauthenticated health response carries only the generic message; the
    // failure is logged by the probe engine, never leaked to the response.
    const indicator = await createIndicator(
      probeStub({ ok: false, reason: 'connect ECONNREFUSED 127.0.0.1:5432' }),
    );

    // Act
    const result = await indicator.check();

    // Assert
    expect(result).toEqual({
      postgres: {
        status: 'degraded',
        message: 'PostgreSQL is unavailable.',
      },
    });
  });
});

describe('DatabaseHealthIndicator.checkReady (strict readiness variant)', () => {
  it('reports up when the probe succeeds', async () => {
    // Arrange
    const indicator = await createIndicator(probeStub({ ok: true }));

    // Act
    const result = await indicator.checkReady();

    // Assert
    expect(result).toEqual({ postgres: { status: 'up' } });
  });

  it('reports down — not degraded — when the probe fails, failing readiness with 503', async () => {
    // Arrange
    const indicator = await createIndicator(
      probeStub({ ok: false, reason: 'PostgreSQL probe timed out after 3000 ms' }),
    );

    // Act
    const result = await indicator.checkReady();

    // Assert
    expect(result).toEqual({
      postgres: {
        status: 'down',
        message: 'PostgreSQL is unavailable.',
      },
    });
  });
});
