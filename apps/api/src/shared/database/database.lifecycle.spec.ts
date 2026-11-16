import { Test } from '@nestjs/testing';
import { MikroORM } from '@mikro-orm/core';
import { PostgreSqlConnection } from '@mikro-orm/postgresql';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DatabaseConnectionInitializer } from './database.connect.js';
import { DatabaseLifecycleLogger } from './database.lifecycle.js';

// Unit tests for the connection lifecycle observer (ADR-034): the pg Pool is
// modeled by a stub with spied `on`/`off` (the two methods of node-postgres'
// own EventEmitter surface that the provider attaches to), and the ORM by a
// stub carrying the same call contract (`isConnected`, `em.getConnection`).
// The connection stub inherits from PostgreSqlConnection.prototype so the
// runtime type check passes without any real connection.

interface PoolStub {
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  off: (event: string, listener: (...args: unknown[]) => void) => void;
}

function createPoolStub(): PoolStub & {
  on: ReturnType<typeof vi.fn<PoolStub['on']>>;
  off: ReturnType<typeof vi.fn<PoolStub['off']>>;
} {
  return {
    on: vi.fn<PoolStub['on']>(),
    off: vi.fn<PoolStub['off']>(),
  };
}

type PoolSpy = ReturnType<typeof createPoolStub>;

function createConnectionStub(pool: PoolStub): PostgreSqlConnection {
  return Object.assign(Object.create(PostgreSqlConnection.prototype), {
    getNativeClient: async () => pool,
  }) as PostgreSqlConnection;
}

async function createLifecycleLogger(orm: {
  isConnected: () => Promise<boolean>;
  em: { getConnection: () => unknown };
}): Promise<DatabaseLifecycleLogger> {
  const module = await Test.createTestingModule({
    providers: [
      { provide: MikroORM, useValue: orm },
      DatabaseConnectionInitializer,
      DatabaseLifecycleLogger,
    ],
  }).compile();
  return module.get(DatabaseLifecycleLogger);
}

describe('DatabaseLifecycleLogger', () => {
  let pool: PoolSpy;
  let orm: {
    isConnected: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
    em: { getConnection: ReturnType<typeof vi.fn<() => unknown>> };
  };
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    pool = createPoolStub();
    orm = {
      isConnected: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
      em: { getConnection: vi.fn<() => unknown>(() => createConnectionStub(pool)) },
    };
    // Logger output is asserted through the prototype, like the redis and
    // memory-protection specs — no coupling to the private instance field.
    logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers pool-level connect and error listeners after the connection is established', async () => {
    // Arrange
    const lifecycle = await createLifecycleLogger(orm);

    // Act
    await lifecycle.onApplicationBootstrap();

    // Assert
    expect(orm.isConnected).toHaveBeenCalledTimes(1);
    expect(pool.on).toHaveBeenCalledTimes(2);
    expect(pool.on).toHaveBeenCalledWith('connect', expect.any(Function));
    expect(pool.on).toHaveBeenCalledWith('error', expect.any(Function));
    // The same stable references must be used for removal later.
    expect(pool.on.mock.calls[0][0]).toBe('connect');
    expect(pool.on.mock.calls[0][1]).toBeDefined();
    expect(pool.on.mock.calls[1][1]).toBeDefined();
  });

  it('logs lifecycle events at their levels without re-registering on a second bootstrap', async () => {
    // Arrange
    const lifecycle = await createLifecycleLogger(orm);
    await lifecycle.onApplicationBootstrap();
    const connectListener = pool.on.mock.calls[0][1] as () => void;
    const errorListener = pool.on.mock.calls[1][1] as (error: Error) => void;
    logSpy.mockClear();

    // Act
    connectListener();
    errorListener(new Error('Connection terminated unexpectedly'));
    await lifecycle.onApplicationBootstrap();

    // Assert
    expect(logSpy).toHaveBeenCalledWith('New PostgreSQL connection established.');
    expect(warnSpy).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'PostgreSQL connection pool error.',
    );
    expect(pool.on).toHaveBeenCalledTimes(2);
  });

  it('skips registration when the ORM is not connected and never touches the pool', async () => {
    // Arrange
    orm.isConnected = vi.fn<() => Promise<boolean>>().mockResolvedValue(false);
    const lifecycle = await createLifecycleLogger(orm);
    warnSpy.mockClear();

    // Act
    await lifecycle.onApplicationBootstrap();

    // Assert — the provider must never be the caller that dials the database.
    expect(pool.on).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'PostgreSQL is not connected; connection lifecycle logging was not registered.',
    );
    // Cleanup without registration is a no-op.
    await expect(lifecycle.beforeApplicationShutdown()).resolves.toBeUndefined();
    expect(pool.off).not.toHaveBeenCalled();
  });

  it('skips registration for non-PostgreSQL connections', async () => {
    // Arrange
    orm.em.getConnection = vi.fn<() => unknown>(() => ({
      constructor: { name: 'SomeOtherConnection' },
    }));
    const lifecycle = await createLifecycleLogger(orm);
    warnSpy.mockClear();

    // Act
    await lifecycle.onApplicationBootstrap();

    // Assert
    expect(pool.on).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'Connection lifecycle logging supports only the PostgreSQL connection; found SomeOtherConnection.',
    );
  });

  it('removes exactly the registered listeners on shutdown and is idempotent', async () => {
    // Arrange
    const lifecycle = await createLifecycleLogger(orm);
    await lifecycle.onApplicationBootstrap();
    const connectListener = pool.on.mock.calls[0][1] as () => void;
    const errorListener = pool.on.mock.calls[1][1] as (error: Error) => void;

    // Act
    await lifecycle.beforeApplicationShutdown();
    await lifecycle.beforeApplicationShutdown();

    // Assert
    expect(pool.off).toHaveBeenCalledTimes(2);
    expect(pool.off).toHaveBeenCalledWith('connect', connectListener);
    expect(pool.off).toHaveBeenCalledWith('error', errorListener);
    // A repeated bootstrap after cleanup may register again (fresh lifecycle).
    await lifecycle.onApplicationBootstrap();
    expect(pool.on).toHaveBeenCalledTimes(4);
  });
});
