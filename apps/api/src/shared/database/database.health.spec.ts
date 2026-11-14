import { HealthIndicatorService } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import { I18nService } from '@nestjs/i18n';
import { MikroORM } from '@mikro-orm/core';
import { describe, expect, it, vi, afterEach } from 'vitest';

import { DatabaseHealthIndicator } from './database.health.js';

// Unit tests must not depend on ambient environment state, so the env
// validation layer is replaced with a fully valid environment.
vi.mock('#config/env/env.config.js', () => ({
  _env: {
    DATABASE_URL: 'postgres://localhost:5432/neo_bank',
  },
}));

type OrmStub = {
  isConnected: () => Promise<boolean>;
  connect: () => Promise<unknown>;
  checkConnection: () => Promise<{ ok: true } | { ok: false; reason: string }>;
};

async function createIndicator(orm: OrmStub) {
  const module = await Test.createTestingModule({
    providers: [
      DatabaseHealthIndicator,
      HealthIndicatorService,
      { provide: MikroORM, useValue: orm },
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

function connectedOrm(checkConnection: OrmStub['checkConnection']): OrmStub {
  return {
    isConnected: vi.fn().mockResolvedValue(true),
    connect: vi.fn().mockResolvedValue(undefined),
    checkConnection,
  };
}

describe('DatabaseHealthIndicator', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports up when the connection check succeeds', async () => {
    // Arrange
    const indicator = await createIndicator(connectedOrm(vi.fn().mockResolvedValue({ ok: true })));

    // Act
    const result = await indicator.check();

    // Assert
    expect(result).toEqual({ postgres: { status: 'up' } });
  });

  it('connects unconditionally, whether or not a connection already exists', async () => {
    // Arrange — connect() is idempotent and cheap; the probe dials every time
    // so checkConnection() always sees an established connection.
    const orm: OrmStub = {
      isConnected: vi.fn().mockResolvedValue(true),
      connect: vi.fn().mockResolvedValue(undefined),
      checkConnection: vi.fn().mockResolvedValue({ ok: true }),
    };
    const indicator = await createIndicator(orm);

    // Act
    const result = await indicator.check();

    // Assert
    expect(result).toEqual({ postgres: { status: 'up' } });
    expect(orm.connect).toHaveBeenCalledTimes(1);
    expect(orm.checkConnection).toHaveBeenCalledTimes(1);
  });

  it('reports degraded — not down — when the connection check fails, keeping the check non-fatal', async () => {
    // Arrange — the raw driver reason must stay server-side (SEC-01): the
    // unauthenticated health response carries only the generic message.
    const indicator = await createIndicator(
      connectedOrm(
        vi.fn().mockResolvedValue({ ok: false, reason: 'connect ECONNREFUSED 127.0.0.1:5432' }),
      ),
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

  it('degrades with the generic message when connecting throws', async () => {
    // Arrange
    const indicator = await createIndicator({
      isConnected: vi.fn().mockResolvedValue(false),
      connect: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:5432')),
      checkConnection: vi.fn().mockResolvedValue({ ok: true }),
    });

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

  it('degrades with a generic message for non-error rejections', async () => {
    // Arrange
    const indicator = await createIndicator({
      isConnected: vi.fn().mockResolvedValue(false),
      connect: vi.fn().mockRejectedValue('boom'),
      checkConnection: vi.fn().mockResolvedValue({ ok: true }),
    });

    // Act
    const result = await indicator.check();

    // Assert
    expect(result).toEqual({
      postgres: { status: 'degraded', message: 'PostgreSQL is unavailable.' },
    });
  });

  it('degrades when the probe exceeds the bounded timeout instead of hanging', async () => {
    // Arrange — a server that never answers the TCP handshake. Fake timers
    // fire the health probe timeout without real waiting.
    vi.useFakeTimers();
    const indicator = await createIndicator({
      isConnected: vi.fn().mockResolvedValue(false),
      connect: vi.fn().mockImplementation(() => new Promise(() => undefined)),
      checkConnection: vi.fn().mockResolvedValue({ ok: true }),
    });

    // Act
    const pending = indicator.check();
    await vi.advanceTimersByTimeAsync(3000);
    const result = await pending;

    // Assert — the timeout reason stays server-side (SEC-01).
    expect(result).toEqual({
      postgres: {
        status: 'degraded',
        message: 'PostgreSQL is unavailable.',
      },
    });
  });
});

describe('DatabaseHealthIndicator.checkReady (strict readiness variant)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports up when the connection check succeeds', async () => {
    // Arrange
    const indicator = await createIndicator(connectedOrm(vi.fn().mockResolvedValue({ ok: true })));

    // Act
    const result = await indicator.checkReady();

    // Assert
    expect(result).toEqual({ postgres: { status: 'up' } });
  });

  it('reports down — not degraded — when the connection check fails, failing readiness with 503', async () => {
    // Arrange
    const indicator = await createIndicator(
      connectedOrm(
        vi.fn().mockResolvedValue({ ok: false, reason: 'connect ECONNREFUSED 127.0.0.1:5432' }),
      ),
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

  it('reports down with the localized fallback for non-error rejections', async () => {
    // Arrange
    const indicator = await createIndicator({
      isConnected: vi.fn().mockResolvedValue(false),
      connect: vi.fn().mockRejectedValue('boom'),
      checkConnection: vi.fn().mockResolvedValue({ ok: true }),
    });

    // Act
    const result = await indicator.checkReady();

    // Assert
    expect(result).toEqual({ postgres: { status: 'down', message: 'PostgreSQL is unavailable.' } });
  });
});
