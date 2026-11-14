import { Test } from '@nestjs/testing';
import { MikroORM } from '@mikro-orm/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DatabaseConnectionInitializer } from './database.connect.js';
import type { DatabaseConnectOptions } from './database.connect.js';

// Unit tests must not depend on ambient environment state, so the env
// validation layer is replaced with a fully valid environment.
vi.mock('#config/env/env.config.js', () => ({
  _env: {
    DATABASE_URL: 'postgres://localhost:5432/neo_bank',
  },
}));

type CheckConnectionResult = { ok: true } | { ok: false; reason: string; error?: Error };

interface OrmStub {
  connect: () => Promise<unknown>;
  // The dialing operation: the attempt verifies the server contact through
  // checkConnection(), so all failure modes are modeled here.
  checkConnection: () => Promise<CheckConnectionResult>;
}

// Test-only retry limits: same shape as production, three orders of
// magnitude faster.
const FAST_OPTIONS: DatabaseConnectOptions = {
  maxAttempts: 3,
  baseDelayMs: 10,
  delayCapMs: 40,
  attemptTimeoutMs: 100,
};

function connectionError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

async function createInitializer(orm: OrmStub, options: DatabaseConnectOptions = FAST_OPTIONS) {
  const module = await Test.createTestingModule({
    providers: [
      { provide: MikroORM, useValue: orm },
      {
        provide: DatabaseConnectionInitializer,
        useFactory: (ormInstance: MikroORM) =>
          new DatabaseConnectionInitializer(ormInstance, options),
        inject: [MikroORM],
      },
    ],
  }).compile();

  return module.get(DatabaseConnectionInitializer);
}

describe('DatabaseConnectionInitializer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('connects and verifies the server on the first attempt without retrying', async () => {
    // Arrange
    const orm: OrmStub = {
      connect: vi.fn<() => Promise<undefined>>().mockResolvedValue(undefined),
      checkConnection: vi
        .fn<() => Promise<CheckConnectionResult>>()
        .mockResolvedValue({ ok: true }),
    };
    const initializer = await createInitializer(orm);

    // Act
    await initializer.onApplicationBootstrap();

    // Assert
    expect(orm.connect).toHaveBeenCalledTimes(1);
    expect(orm.checkConnection).toHaveBeenCalledTimes(1);
  });

  it('succeeds after temporary connection failures', async () => {
    // Arrange
    vi.useFakeTimers();
    const orm: OrmStub = {
      connect: vi.fn<() => Promise<undefined>>().mockResolvedValue(undefined),
      checkConnection: vi
        .fn<() => Promise<CheckConnectionResult>>()
        .mockRejectedValueOnce(
          connectionError('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:5432'),
        )
        .mockRejectedValueOnce(
          connectionError('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:5432'),
        )
        .mockResolvedValue({ ok: true }),
    };
    const initializer = await createInitializer(orm, { ...FAST_OPTIONS, maxAttempts: 5 });

    // Act
    const pending = initializer.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(100);
    await pending;

    // Assert
    expect(orm.connect).toHaveBeenCalledTimes(3);
    expect(orm.checkConnection).toHaveBeenCalledTimes(3);
  });

  it('fails startup with a meaningful error after exhausting the attempts', async () => {
    // Arrange
    vi.useFakeTimers();
    const orm: OrmStub = {
      connect: vi.fn<() => Promise<undefined>>().mockResolvedValue(undefined),
      checkConnection: vi
        .fn<() => Promise<CheckConnectionResult>>()
        .mockRejectedValue(connectionError('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:5432')),
    };
    const initializer = await createInitializer(orm);

    // Act & Assert — a handler is attached before the timers advance: the
    // rejection can fire while fake timers run, and a momentarily-unhandled
    // rejection makes Vitest fail the whole run as a suite error even though
    // the assertion later passes.
    const pending = initializer.onApplicationBootstrap();
    pending.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(200);

    // Assert
    await expect(pending).rejects.toThrow(
      'PostgreSQL connection failed after 3 attempts: connect ECONNREFUSED 127.0.0.1:5432',
    );
    expect(orm.connect).toHaveBeenCalledTimes(3);
    expect(orm.checkConnection).toHaveBeenCalledTimes(3);
  });

  it('reports a failed connection check through its preserved error, keeping SQLSTATE classification', async () => {
    // Arrange — checkConnection reports a failed probe via {ok:false,error};
    // the original pg error (with its SQLSTATE) must drive classification.
    vi.useFakeTimers();
    const authError = connectionError(
      '28P01',
      'password authentication failed for user "neo_bank"',
    );
    const orm: OrmStub = {
      connect: vi.fn<() => Promise<undefined>>().mockResolvedValue(undefined),
      checkConnection: vi
        .fn<() => Promise<CheckConnectionResult>>()
        .mockResolvedValue({ ok: false, reason: authError.message, error: authError }),
    };
    const initializer = await createInitializer(orm, { ...FAST_OPTIONS, maxAttempts: 5 });

    // Act & Assert
    await expect(initializer.onApplicationBootstrap()).rejects.toThrow(
      'password authentication failed for user "neo_bank"',
    );
    expect(orm.connect).toHaveBeenCalledTimes(1);
    expect(orm.checkConnection).toHaveBeenCalledTimes(1);
  });

  it('fails immediately without retrying permanent authentication errors', async () => {
    // Arrange
    vi.useFakeTimers();
    const orm: OrmStub = {
      connect: vi.fn<() => Promise<undefined>>().mockResolvedValue(undefined),
      checkConnection: vi
        .fn<() => Promise<CheckConnectionResult>>()
        .mockRejectedValue(
          connectionError('28P01', 'password authentication failed for user "neo_bank"'),
        ),
    };
    const initializer = await createInitializer(orm, { ...FAST_OPTIONS, maxAttempts: 5 });

    // Act & Assert
    await expect(initializer.onApplicationBootstrap()).rejects.toThrow(
      'password authentication failed for user "neo_bank"',
    );
    expect(orm.connect).toHaveBeenCalledTimes(1);
    expect(orm.checkConnection).toHaveBeenCalledTimes(1);
  });

  it('fails immediately without retrying a missing database', async () => {
    // Arrange
    vi.useFakeTimers();
    const orm: OrmStub = {
      connect: vi.fn<() => Promise<undefined>>().mockResolvedValue(undefined),
      checkConnection: vi
        .fn<() => Promise<CheckConnectionResult>>()
        .mockRejectedValue(connectionError('3D000', 'database "missing" does not exist')),
    };
    const initializer = await createInitializer(orm, { ...FAST_OPTIONS, maxAttempts: 5 });

    // Act & Assert
    await expect(initializer.onApplicationBootstrap()).rejects.toThrow('does not exist');
    expect(orm.connect).toHaveBeenCalledTimes(1);
    expect(orm.checkConnection).toHaveBeenCalledTimes(1);
  });

  it('bounds a hanging connection attempt with the per-attempt timeout', async () => {
    // Arrange — a host that accepts no packets and never answers.
    vi.useFakeTimers();
    const orm: OrmStub = {
      connect: vi.fn<() => Promise<undefined>>().mockResolvedValue(undefined),
      checkConnection: vi
        .fn<() => Promise<CheckConnectionResult>>()
        .mockImplementation(() => new Promise(() => undefined)),
    };
    const initializer = await createInitializer(orm, {
      maxAttempts: 1,
      baseDelayMs: 10,
      delayCapMs: 10,
      attemptTimeoutMs: 50,
    });

    // Act & Assert — defensive handler attached before the timers advance
    // (same momentarily-unhandled-rejection hazard as the exhaustion test).
    const pending = initializer.onApplicationBootstrap();
    pending.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(100);

    // Assert
    await expect(pending).rejects.toThrow('PostgreSQL connection attempt timed out after 50 ms');
    expect(orm.connect).toHaveBeenCalledTimes(1);
    expect(orm.checkConnection).toHaveBeenCalledTimes(1);
  });
});
