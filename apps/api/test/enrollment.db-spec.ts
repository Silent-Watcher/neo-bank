import { EntityManager, MikroORM } from '@mikro-orm/core';
import type { Connection } from '@mikro-orm/core';
import { MIKRO_ORM_MODULE_OPTIONS } from '@mikro-orm/nestjs';
import { PostgreSqlDriver, PostgreSqlConnection } from '@mikro-orm/postgresql';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Enrollment } from '#modules/enrollments/entities/enrollment.entity.js';
import {
  ENROLLMENT_SCHEMA_CONSTRAINT_NAMES,
  ENROLLMENT_STATUS_EXPIRED,
  ENROLLMENT_STATUSES,
  ENROLLMENT_TTL_MS,
} from '#modules/enrollments/enrollments.enums.js';
import { BaseEntity } from '#database/base.entity.js';
import {
  buildRuntimeMikroOrmOptions,
  DATABASE_POOL_MAX_DEFAULT,
} from '#database/mikro-orm.options.js';
import { DatabaseLifecycleLogger } from '#database/database.lifecycle.js';

import { createTestApp } from './create-test-app.js';
import { startTestPostgres } from './testcontainers.js';
import type { TestPostgres } from './testcontainers.js';

// Enrollment integration tier: the first concrete feature entity, driven
// through the real AppModule (EnrollmentsModule's forFeature registration)
// against its own Testcontainers PostgreSQL container (ADR-016). Proves the
// ADR-041 core data model: column contracts, the four check constraints, the
// partial unique phone index, and the database-native uuidv7() default, all
// against real PostgreSQL. The base columns and audit lifecycle are proven
// in test/base-entity.db-spec.ts. Redis keeps the validation-only
// placeholder from env/.env.db-test, so the throttler storage is swapped for
// the official in-memory service.

let postgres: TestPostgres;
let databaseUrl: string;

// PostgreSQL uuid textual form: version nibble fixed at 7, RFC 4122 variant
// nibble in [89ab] — proves the uuidv7() column default (ADR-041).
const UUIDV7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
        ...buildRuntimeMikroOrmOptions(databaseUrl, DATABASE_POOL_MAX_DEFAULT),
        entities: [BaseEntity, Enrollment],
        autoLoadEntities: false,
      });
      builder.overrideProvider(ThrottlerStorage).useValue(new ThrottlerStorageService());
    },
  });
}

// Distinct phones per test keep the constraint tests independent within the
// shared file container. Raw inserts supply created_at and expires_at
// explicitly — neither has a database default (the one-clock-reading rule,
// ADR-041); test-side SQL clock readings (now() + interval) exercise the
// database contract only, while application-side expiration is an entity
// initializer (proven in the round-trip test).
const INSERT_ACTIVE_ENROLLMENT = `INSERT INTO enrollments (phone_number, created_at, expires_at) VALUES (?, now(), now() + interval '24 hours')`;
const INSERT_ENROLLMENT_WITH_STATUS = `INSERT INTO enrollments (phone_number, created_at, expires_at, status) VALUES (?, now(), now() + interval '24 hours', ?)`;

async function insertEnrollment(
  connection: Connection,
  phone: string,
  status?: string,
): Promise<unknown> {
  if (status === undefined) return connection.execute(INSERT_ACTIVE_ENROLLMENT, [phone]);
  return connection.execute(INSERT_ENROLLMENT_WITH_STATUS, [phone, status]);
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
        'public_id',
        'status',
        'current_step',
        'expires_at',
      ].sort(),
    );
    expect(byName.get('phone_number')).toMatchObject({
      data_type: 'character varying',
      is_nullable: 'NO',
    });
    expect(byName.get('public_id')).toMatchObject({ data_type: 'uuid', is_nullable: 'NO' });
    expect(byName.get('status')).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(byName.get('current_step')).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(byName.get('expires_at')).toMatchObject({
      data_type: 'timestamp with time zone',
      is_nullable: 'NO',
    });
    expect(byName.get('id')).toMatchObject({ data_type: 'bigint', is_nullable: 'NO' });
    await app.close();
  });

  it('declares the primary key, the base check, the enrollment checks, and the public_id unique constraint', async () => {
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
    for (const name of [
      ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.phoneNumberFormat,
      ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.publicIdUuidv7,
      ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.statusValid,
      ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.currentStepValid,
    ] as const) {
      expect(
        constraints.some((constraint) => constraint.conname === name && constraint.contype === 'c'),
      ).toBe(true);
    }
    expect(
      constraints.some(
        (constraint) =>
          constraint.conname === ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.publicIdUnique &&
          constraint.contype === 'u',
      ),
    ).toBe(true);
    expect(constraints.filter((constraint) => constraint.contype === 'f')).toHaveLength(0);
    await app.close();
  });

  it('creates the partial unique index on phone_number excluding EXPIRED rows', async () => {
    // Arrange
    const app = await createProbeApp();
    const em = app.get(EntityManager);

    // Act
    const indexes: Array<{ indexdef: string }> = await em
      .getConnection()
      .execute(
        `SELECT indexdef FROM pg_indexes WHERE indexname = '${ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.phoneActiveUnique}'`,
      );

    // Assert — the one-active-per-phone invariant indexes exactly the phone
    // column and predicates on persisted lifecycle status only (ADR-041):
    // no now(), no expires_at.
    expect(indexes).toHaveLength(1);
    expect(indexes[0].indexdef).toContain('CREATE UNIQUE INDEX');
    expect(indexes[0].indexdef).toMatch(/USING btree \(phone_number\)/);
    expect(indexes[0].indexdef).toContain("'EXPIRED'");
    expect(indexes[0].indexdef).not.toContain('now()');
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

  it('round-trips a persisted row: string BIGINT id, database-generated version-7 public_id, defaults, and the 24-hour expiry', async () => {
    // Arrange
    const app = await createProbeApp();
    const em = app.get(EntityManager).fork();
    const enrollment = em.create(Enrollment, { phoneNumber: '09123456789' });

    // Act
    await em.flush();
    const persisted = await em.findOneOrFail(Enrollment, { id: enrollment.id });
    const raw: Array<{
      phone_number: string;
      created_at: string | Date;
      expires_at: string | Date;
      status: string;
      current_step: string;
      uuid_version: number;
    }> = await em.getConnection().execute(
      `SELECT phone_number, created_at, expires_at, status, current_step,
              uuid_extract_version(public_id) AS uuid_version
         FROM enrollments WHERE id = ?`,
      [enrollment.id],
    );

    // Assert
    expect(typeof enrollment.id).toBe('string');
    expect(typeof enrollment.publicId).toBe('string');
    expect(enrollment.publicId).toMatch(UUIDV7_PATTERN);
    expect(persisted.phoneNumber).toBe('09123456789');
    expect(persisted.status).toBe('INITIAL');
    expect(persisted.currentStep).toBe('NATIONAL_CODE');
    expect(persisted.version).toBe(1);
    expect(persisted.createdBy).toBeNull();
    expect(persisted.updatedAt).toBeNull();
    expect(persisted.deletedAt).toBeNull();
    expect(persisted.createdAt.getTime()).toBe(new Date(raw[0].created_at).getTime());
    expect(persisted.expiresAt.getTime() - persisted.createdAt.getTime()).toBe(ENROLLMENT_TTL_MS);
    // The persisted expires_at matches the entity value — the column the
    // no-database-default design exists to protect (ADR-041).
    expect(new Date(raw[0].expires_at).getTime()).toBe(persisted.expiresAt.getTime());
    expect(raw[0].phone_number).toBe('09123456789');
    expect(raw[0].status).toBe('INITIAL');
    expect(raw[0].current_step).toBe('NATIONAL_CODE');
    expect(raw[0].uuid_version).toBe(7);
    await app.close();
  });
});

describe('One-active-per-phone invariant (ADR-041)', () => {
  it('rejects a second active enrollment for the same phone number', async () => {
    // Arrange
    const app = await createProbeApp();
    const connection = app.get(EntityManager).getConnection();
    await insertEnrollment(connection, '09120000001');

    // Act & Assert
    await expect(insertEnrollment(connection, '09120000001')).rejects.toThrowError(
      new RegExp(ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.phoneActiveUnique),
    );
    await app.close();
  });

  it('blocks a second enrollment for every status that occupies the phone number', async () => {
    // Arrange
    const app = await createProbeApp();
    const connection = app.get(EntityManager).getConnection();
    const blockingStatuses = ENROLLMENT_STATUSES.filter(
      (status) => status !== ENROLLMENT_STATUS_EXPIRED,
    );

    // Act & Assert — each blocking status occupies its own phone number.
    for (const [index, status] of blockingStatuses.entries()) {
      // Own 091200010xx range (11 chars, inside the format CHECK) — distinct
      // from every other test's phone in this shared file container.
      const phone = `0912000100${index}`;
      await insertEnrollment(connection, phone);
      await expect(insertEnrollment(connection, phone, status)).rejects.toThrowError(
        new RegExp(ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.phoneActiveUnique),
      );
    }
    await app.close();
  });

  it('an expired enrollment releases the phone number and multiple historical expired records may share it', async () => {
    // Arrange
    const app = await createProbeApp();
    const connection = app.get(EntityManager).getConnection();
    await insertEnrollment(connection, '09120000002', ENROLLMENT_STATUS_EXPIRED);

    // Act
    await insertEnrollment(connection, '09120000002', ENROLLMENT_STATUS_EXPIRED);
    await insertEnrollment(connection, '09120000002');

    // Assert — two EXPIRED rows and one active row coexist on one phone.
    const counts: Array<{ status: string; total: string }> = await connection.execute(
      `SELECT status, count(*) AS total FROM enrollments WHERE phone_number = '09120000002' GROUP BY status`,
    );
    expect(counts.find((row) => row.status === 'EXPIRED')?.total).toBe('2');
    expect(counts.find((row) => row.status === 'INITIAL')?.total).toBe('1');
    await app.close();
  });
});

describe('Database-enforced column contracts (ADR-041)', () => {
  it('rejects a phone number outside the canonical national format', async () => {
    // Arrange
    const app = await createProbeApp();
    const connection = app.get(EntityManager).getConnection();

    // Act & Assert — two independent contract layers reject non-canonical
    // shapes (ADR-041): the varchar(11) physical cap rejects over-long
    // input (the E.164 spelling), and the format CHECK rejects any
    // 11-character value outside ^09[0-9]{9}$.
    await expect(insertEnrollment(connection, '+15551234567')).rejects.toThrowError(
      /value too long for type character varying\(11\)/,
    );
    await expect(insertEnrollment(connection, '091234567890')).rejects.toThrowError(
      /value too long for type character varying\(11\)/,
    );
    await expect(insertEnrollment(connection, '08123456789')).rejects.toThrowError(
      new RegExp(ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.phoneNumberFormat),
    );
    await expect(insertEnrollment(connection, '0912345678X')).rejects.toThrowError(
      new RegExp(ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.phoneNumberFormat),
    );
    await app.close();
  });

  it('rejects unknown status and step values', async () => {
    // Arrange
    const app = await createProbeApp();
    const connection = app.get(EntityManager).getConnection();

    // Act & Assert
    await expect(insertEnrollment(connection, '09120000003', 'BOGUS_STATUS')).rejects.toThrowError(
      new RegExp(ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.statusValid),
    );
    await expect(
      connection.execute(
        `INSERT INTO enrollments (phone_number, created_at, expires_at, current_step) VALUES (?, now(), now() + interval '24 hours', ?)`,
        ['09120000004', 'BOGUS_STEP'],
      ),
    ).rejects.toThrowError(new RegExp(ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.currentStepValid));
    await app.close();
  });

  it('requires expires_at to be supplied by the application (no database default)', async () => {
    // Arrange
    const app = await createProbeApp();
    const connection = app.get(EntityManager).getConnection();

    // Act & Assert — the one-clock-reading rule (ADR-041): the database must
    // not pair its own clock with the application-set created_at.
    await expect(
      connection.execute(`INSERT INTO enrollments (phone_number, created_at) VALUES (?, now())`, [
        '09120000005',
      ]),
    ).rejects.toThrowError(/expires_at/);
    await app.close();
  });

  it('generates a version-7 public_id from the database default for raw inserts too', async () => {
    // Arrange
    const app = await createProbeApp();
    const connection = app.get(EntityManager).getConnection();

    // Act — the insert omits public_id entirely; the column default applies.
    await insertEnrollment(connection, '09120000006');
    const rows: Array<{ public_id: string; uuid_version: number }> = await connection.execute(
      `SELECT public_id, uuid_extract_version(public_id) AS uuid_version
         FROM enrollments WHERE phone_number = '09120000006'`,
    );

    // Assert
    expect(rows).toHaveLength(1);
    expect(rows[0].public_id).toMatch(UUIDV7_PATTERN);
    expect(rows[0].uuid_version).toBe(7);
    await app.close();
  });
});
