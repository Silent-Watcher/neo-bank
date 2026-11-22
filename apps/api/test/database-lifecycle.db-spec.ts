import { EntityManager, MikroORM } from '@mikro-orm/core';
import { PostgreSqlConnection } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DatabaseLifecycleLogger } from '#database/database.lifecycle.js';

import { createProbeApp } from './create-probe-app.js';
import { startTestPostgres } from './testcontainers.js';
import type { TestPostgres } from './testcontainers.js';

// Database lifecycle integration tier (ADR-034): proves that a real
// AppModule boot registers the lifecycle logger's pool listeners and that
// they detach/reattach cleanly. This is infrastructure coverage, not
// Enrollment coverage — it lives in its own file so the enrollment suite
// stays about the data model (DEFERRED _060 entry 2, Wave 31 CR-07).

let postgres: TestPostgres;
let databaseUrl: string;

beforeAll(async () => {
  ({ postgres, url: databaseUrl } = await startTestPostgres());
  const app = await createProbeApp(databaseUrl);
  await app.get(MikroORM).schema.create();
  await app.close();
});

afterAll(async () => {
  await postgres.stop();
});

describe('Database pool lifecycle (ADR-034)', () => {
  it('registers the pool lifecycle listeners during a real boot', async () => {
    // Arrange — a plain AppModule boot (createTestApp calls app.init(), so
    // the bootstrap hooks have already run): the DI edge from the lifecycle
    // logger to the connection initializer must sequence the bootstrap
    // hooks so the logger's own listeners exist on the real pool after
    // startup. The driver pre-registers its own pool listeners
    // (handlePoolErrors), so counting is only discriminating relative to a
    // baseline: detaching the logger must remove exactly one listener per
    // event, re-attaching must restore the baseline.
    const app = await createProbeApp(databaseUrl);
    const orm = app.get(MikroORM);
    const lifecycle = app.get(DatabaseLifecycleLogger);
    const connection = orm.em.getConnection();
    expect(connection).toBeInstanceOf(PostgreSqlConnection);
    const pool = await (connection as PostgreSqlConnection).getNativeClient();
    const connectBaseline = pool.listenerCount('connect');
    const errorBaseline = pool.listenerCount('error');

    // Act — remove exactly the logger's own listeners, then re-register.
    await lifecycle.beforeApplicationShutdown();
    const afterDetach = {
      connect: pool.listenerCount('connect'),
      error: pool.listenerCount('error'),
    };
    await lifecycle.onApplicationBootstrap();
    const afterReattach = {
      connect: pool.listenerCount('connect'),
      error: pool.listenerCount('error'),
    };

    // Assert — a boot without the lifecycle logger's listeners would show a
    // zero drop here (only the driver's own listeners remain).
    expect(afterDetach.connect).toBe(connectBaseline - 1);
    expect(afterDetach.error).toBe(errorBaseline - 1);
    expect(afterReattach.connect).toBe(connectBaseline);
    expect(afterReattach.error).toBe(errorBaseline);
    await app.close();
  });
});
