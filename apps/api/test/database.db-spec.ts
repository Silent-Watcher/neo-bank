import { EntityManager, MikroORM } from '@mikro-orm/core';
import { MIKRO_ORM_MODULE_OPTIONS } from '@mikro-orm/nestjs';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { TestingModuleBuilder } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';

import { AppModule } from '#modules/app/app.module.js';
import { DatabaseConnectionInitializer } from '#database/database.connect.js';
import type { DatabaseConnectOptions } from '#database/database.connect.js';
import { buildRuntimeMikroOrmOptions } from '#database/mikro-orm.options.js';

import { createTestApp } from './create-test-app.js';
import { startTestPostgres, type TestPostgres } from './testcontainers.js';

// Database integration tier (ADR-027): boots the real AppModule against its
// own Testcontainers PostgreSQL container. Redis keeps the validation-only
// placeholder from env/.env.db-test — the health endpoints skip the
// throttler and report Redis degraded without needing it, so Redis is
// never contacted here.

let postgres: TestPostgres;
let databaseUrl: string;

beforeAll(async () => {
  ({ postgres, url: databaseUrl } = await startTestPostgres());
});

afterAll(async () => {
  await postgres.stop();
});

function overrideDatabaseUrl(builder: TestingModuleBuilder, url: string): void {
  // @nestjs/config's ConfigService holds the registerAs factory result and
  // does not observe provider overrides on the namespace token, so the ORM
  // options themselves are supplied — the same mechanism the Redis suites
  // use when overriding REDIS_CLIENT (the integration rebuilds the ORM from
  // these options and keeps owning its lifecycle).
  builder.overrideProvider(MIKRO_ORM_MODULE_OPTIONS).useValue({
    // The shape comes from the shared runtime builder; the driver rides
    // along exactly as the runtime module supplies it (without it
    // MikroORM.init cannot build the driver).
    driver: PostgreSqlDriver,
    ...buildRuntimeMikroOrmOptions(url),
  });
}

describe('Database integration (AppModule boot against PostgreSQL)', () => {
  it('boots with zero entities and resolves MikroORM and EntityManager through DI', async () => {
    // Arrange
    const app = await createTestApp(undefined, {
      configureModule: (builder) => overrideDatabaseUrl(builder, databaseUrl),
    });

    // Act
    const orm = app.get(MikroORM);
    const em = app.get(EntityManager);

    // Assert
    expect(orm).toBeDefined();
    expect(em).toBeDefined();
    await app.close();
  });

  it('reports the postgres indicator as up on the liveness endpoint', async () => {
    // Arrange
    const app = await createTestApp(undefined, {
      configureModule: (builder) => overrideDatabaseUrl(builder, databaseUrl),
    });

    // Act
    const response = await request(app.getHttpServer()).get('/health');

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data.info.postgres.status).toBe('up');
    await app.close();
  });

  it('fails startup after exhausting the bounded retries when PostgreSQL is unreachable (ADR-027 amendment)', async () => {
    // Arrange — a closed loopback port fails fast with ECONNREFUSED; the
    // initializer's retry limits are injected at test speed. The boot is
    // driven inline (createTestApp cannot hand back a half-initialized app
    // when init() rejects) so the partially initialized providers can be
    // shut down in the finally block.
    const retryLimits: DatabaseConnectOptions = {
      maxAttempts: 2,
      baseDelayMs: 10,
      delayCapMs: 10,
      attemptTimeoutMs: 500,
    };
    const moduleBuilder = Test.createTestingModule({ imports: [AppModule] });
    overrideDatabaseUrl(moduleBuilder, 'postgresql://neo_bank:test-password@127.0.0.1:1/neo_bank');
    moduleBuilder.overrideProvider(DatabaseConnectionInitializer).useFactory({
      factory: (orm: MikroORM) => new DatabaseConnectionInitializer(orm, retryLimits),
      inject: [MikroORM],
    });
    const module = await moduleBuilder.compile();
    // The boot fails in the lifecycle hooks before any HTTP behavior matters;
    // the Fastify adapter matches the project platform.
    const app = module.createNestApplication(new FastifyAdapter());

    // Act & Assert
    try {
      await expect(app.init()).rejects.toThrow(
        'PostgreSQL connection failed after 2 attempts: connect ECONNREFUSED 127.0.0.1:1',
      );
    } finally {
      // Boot failed mid-lifecycle: shut the providers that did initialize
      // down explicitly (Redis client reconnect loop, ORM pool).
      await app.close();
    }
  });

  it('closes the database connection on application shutdown', async () => {
    // Arrange
    const app = await createTestApp(undefined, {
      configureModule: (builder) => overrideDatabaseUrl(builder, databaseUrl),
    });
    const orm = app.get(MikroORM);

    // Act
    await app.close();

    // Assert
    expect(await orm.isConnected()).toBe(false);
  });
});
