import { EntityManager, MikroORM } from '@mikro-orm/core';
import { MIKRO_ORM_MODULE_OPTIONS } from '@mikro-orm/nestjs';
import { PostgreSqlDriver, PostgreSqlConnection } from '@mikro-orm/postgresql';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Enrollment } from '#modules/enrollments/entities/enrollment.entity.js';
import { BaseEntity } from '#database/base.entity.js';
import { buildRuntimeMikroOrmOptions } from '#database/mikro-orm.options.js';
import { DatabaseLifecycleLogger } from '#database/database.lifecycle.js';

import { createTestApp } from './create-test-app.js';
import { startTestPostgres, type TestPostgres } from './testcontainers.js';

// Enrollment integration tier: the first concrete feature entity, driven
// through the real AppModule (EnrollmentsModule's forFeature registration)
// against its own Testcontainers PostgreSQL container. The base columns and
// audit lifecycle are proven in test/base-entity.db-spec.ts; this spec
// verifies the Enrollment-specific table shape and persistence. Redis keeps
// the validation-only placeholder from env/.env.db-test, so the throttler
// storage is swapped for the official in-memory service.

let postgres: TestPostgres;
let databaseUrl: string;

beforeAll(async () => {
  ({ postgres, url: databaseUrl } = await startTestPostgres());
  const app = await createProbeApp();
  await app.get(MikroORM).schema.create();
  await app.close();
});

afterAll(async () => {
  await postgres.stop();
});

function createProbeApp() {
  return createTestApp(undefined, {
    configureModule: (builder) => {
      // The ORM options themselves are supplied (not the DATABASE_CONFIG
      // namespace token — ConfigService holds the registerAs factory result
      // and does not observe provider overrides on it). Both entities are
      // listed explicitly (the MikroORM rule for explicit entity lists):
      // with autoLoadEntities on, @mikro-orm/nestjs copies forFeature
      // registrations into `entitiesTs`, and TS-mode discovery (Vitest)
      // uses `entitiesTs` INSTEAD of `entities` — the override must not
      // depend on that path.
      builder.overrideProvider(MIKRO_ORM_MODULE_OPTIONS).useValue({
        driver: PostgreSqlDriver,
        ...buildRuntimeMikroOrmOptions(databaseUrl),
        entities: [BaseEntity, Enrollment],
        autoLoadEntities: false,
      });
      builder.overrideProvider(ThrottlerStorage).useValue(new ThrottlerStorageService());
    },
  });
}

describe('Enrollment schema shape', () => {
  it('creates the enrollments table with snake_case columns and no base_entity table', async () => {
    // Arrange
    const app = await createProbeApp();
    const em = app.get(EntityManager);

    // Act
    const baseTables: Array<{ table_name: string }> = await em
      .getConnection()
      .execute(`SELECT table_name FROM information_schema.tables WHERE table_name = 'base_entity'`);
    const columns: Array<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }> = await em.getConnection().execute(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_name = 'enrollments'
         ORDER BY ordinal_position`,
    );

    // Assert
    expect(baseTables).toHaveLength(0);
    const byName = new Map(columns.map((column) => [column.column_name, column]));
    expect([...byName.keys()].sort()).toEqual(
      [
        'id',
        'created_at',
        'updated_at',
        'created_by',
        'updated_by',
        'version',
        'deleted_at',
        'phone_number',
      ].sort(),
    );
    expect(byName.get('phone_number')).toMatchObject({
      data_type: 'character varying',
      is_nullable: 'NO',
    });
    expect(byName.get('id')).toMatchObject({ data_type: 'bigint', is_nullable: 'NO' });
    await app.close();
  });

  it('declares the primary key and the base check, and no foreign keys', async () => {
    // Arrange
    const app = await createProbeApp();
    const em = app.get(EntityManager);

    // Act
    const constraints: Array<{ contype: string; conname: string }> = await em
      .getConnection()
      .execute(
        `SELECT contype::text AS contype, conname FROM pg_constraint WHERE conrelid = 'enrollments'::regclass`,
      );

    // Assert
    expect(constraints.some((constraint) => constraint.contype === 'p')).toBe(true);
    expect(
      constraints.some(
        (constraint) =>
          constraint.conname === 'base_entity_id_positive' && constraint.contype === 'c',
      ),
    ).toBe(true);
    expect(constraints.filter((constraint) => constraint.contype === 'f')).toHaveLength(0);
    await app.close();
  });
});

describe('Enrollment persistence', () => {
  it('registers the pool lifecycle listeners during a real boot (ADR-034)', async () => {
    // Arrange — a plain AppModule boot (createTestApp calls app.init(), so
    // the bootstrap hooks have already run): the DI edge from the lifecycle
    // logger to the connection initializer must sequence the bootstrap
    // hooks so the logger's own listeners exist on the real pool after
    // startup. The driver pre-registers its own pool listeners
    // (handlePoolErrors), so counting is only discriminating relative to a
    // baseline: detaching the logger must remove exactly one listener per
    // event, re-attaching must restore the baseline.
    const app = await createProbeApp();
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

  it('round-trips a persisted row with a string BIGINT id and UTC-stored creation instant', async () => {
    // Arrange
    const app = await createProbeApp();
    const em = app.get(EntityManager).fork();
    const enrollment = em.create(Enrollment, { phoneNumber: '+15551234567' });

    // Act
    await em.flush();
    const persisted = await em.findOneOrFail(Enrollment, { id: enrollment.id });
    const raw: Array<{ created_at: string; phone_number: string }> = await em
      .getConnection()
      .execute(`SELECT phone_number, created_at FROM enrollments WHERE id = ?`, [enrollment.id]);

    // Assert
    expect(typeof enrollment.id).toBe('string');
    expect(persisted.phoneNumber).toBe('+15551234567');
    expect(persisted.version).toBe(1);
    expect(persisted.createdBy).toBeNull();
    expect(persisted.updatedAt).toBeNull();
    expect(persisted.deletedAt).toBeNull();
    expect(persisted.createdAt.getTime()).toBe(Date.parse(raw[0].created_at));
    expect(raw[0].phone_number).toBe('+15551234567');
    await app.close();
  });
});
