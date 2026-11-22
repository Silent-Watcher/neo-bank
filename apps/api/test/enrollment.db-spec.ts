import { EntityManager, LockMode, MikroORM } from '@mikro-orm/core';
import type { Connection } from '@mikro-orm/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppHttpException } from '#errors/app-http.exception.js';
import { ErrorCode } from '#errors/error.code.js';
import { mapOptimisticLockError } from '#errors/optimistic-lock.mapper.js';
import { Enrollment } from '#modules/enrollments/entities/enrollment.entity.js';
import {
  ENROLLMENT_INITIAL_STATUS,
  ENROLLMENT_INITIAL_STEP,
  ENROLLMENT_SCHEMA_CONSTRAINT_NAMES,
  ENROLLMENT_STATUS_EXPIRED,
  ENROLLMENT_STATUSES,
  ENROLLMENT_TTL_MS,
} from '#modules/enrollments/enrollments.enums.js';
import { EnrollmentStateMachine } from '#modules/enrollments/enrollment-state-machine.service.js';
import { EnrollmentStateMachineError } from '#modules/enrollments/enrollment-state-machine.error.js';

import { createProbeApp } from './create-probe-app.js';
import { startTestPostgres } from './testcontainers.js';
import type { TestPostgres } from './testcontainers.js';

// Enrollment integration tier: the first concrete feature entity, driven
// through the real AppModule (EnrollmentsModule's forFeature registration)
// against its own Testcontainers PostgreSQL container (ADR-016). Proves the
// ADR-041 core data model and the ADR-042 step-data contracts: column
// contracts, all eleven enrollment check constraints, the three partial
// unique identifier indexes with their expired-release predicates, and the
// database-native uuidv7() default — all against real PostgreSQL. The base
// columns and audit lifecycle are proven in test/base-entity.db-spec.ts;
// the pool-lifecycle coverage lives in test/database-lifecycle.db-spec.ts;
// the migration-replay parity lives in test/migrations-parity.db-spec.ts.

let postgres: TestPostgres;
let databaseUrl: string;

// PostgreSQL uuid textual form: version nibble fixed at 7, RFC 4122 variant
// nibble in [89ab] — proves the uuidv7() column default (ADR-041).
const UUIDV7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

beforeAll(async () => {
  ({ postgres, url: databaseUrl } = await startTestPostgres());
  const app = await createProbeApp(databaseUrl);
  await app.get(MikroORM).schema.create();
  await app.close();
});

afterAll(async () => {
  await postgres.stop();
});

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

const INSERT_ENROLLMENT_WITH_IDENTITY = `INSERT INTO enrollments (phone_number, created_at, expires_at, national_code, username) VALUES (?, now(), now() + interval '24 hours', ?, ?)`;
const INSERT_ENROLLMENT_WITH_IDENTITY_AND_STATUS = `INSERT INTO enrollments (phone_number, created_at, expires_at, national_code, username, status) VALUES (?, now(), now() + interval '24 hours', ?, ?, ?)`;

async function insertEnrollmentWithIdentity(
  connection: Connection,
  phone: string,
  identity: { nationalCode?: string; username?: string },
  status?: string,
): Promise<unknown> {
  if (status === undefined) {
    return connection.execute(INSERT_ENROLLMENT_WITH_IDENTITY, [
      phone,
      identity.nationalCode ?? null,
      identity.username ?? null,
    ]);
  }
  return connection.execute(INSERT_ENROLLMENT_WITH_IDENTITY_AND_STATUS, [
    phone,
    identity.nationalCode ?? null,
    identity.username ?? null,
    status,
  ]);
}

// One statement covering every prose column: length-contract violations set
// one over-length value among otherwise-valid ones (ADR-042).
const INSERT_ENROLLMENT_PROSE = `INSERT INTO enrollments (phone_number, created_at, expires_at, first_name, last_name, referral_code, occupation, video_key) VALUES (?, now(), now() + interval '24 hours', ?, ?, ?, ?, ?)`;

const INSERT_ENROLLMENT_WITH_BIRTH_DATE = `INSERT INTO enrollments (phone_number, created_at, expires_at, birth_date) VALUES (?, now(), now() + interval '24 hours', ?)`;

describe('Enrollment schema shape', () => {
  it('creates the enrollments table with snake_case columns and no base_entity table', async () => {
    // Arrange
    const app = await createProbeApp(databaseUrl);
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
        'national_code',
        'first_name',
        'last_name',
        'birth_date',
        'referral_code',
        'username',
        'password_hash',
        'occupation',
        'video_key',
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
    // Step-data columns (ADR-042): all nullable, no defaults.
    expect(byName.get('national_code')).toMatchObject({
      data_type: 'character varying',
      is_nullable: 'YES',
    });
    expect(byName.get('first_name')).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    expect(byName.get('last_name')).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    expect(byName.get('birth_date')).toMatchObject({ data_type: 'date', is_nullable: 'YES' });
    expect(byName.get('referral_code')).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    expect(byName.get('username')).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    expect(byName.get('password_hash')).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    expect(byName.get('occupation')).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    expect(byName.get('video_key')).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    await app.close();
  });

  it('declares the primary key, the base check, the enrollment checks, and the public_id unique constraint', async () => {
    // Arrange
    const app = await createProbeApp(databaseUrl);
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
      ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.nationalCodeFormat,
      ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.usernameFormat,
      ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.firstNameLength,
      ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.lastNameLength,
      ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.referralCodeLength,
      ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.occupationLength,
      ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.videoKeyLength,
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

  it('creates the three partial unique identifier indexes with lifecycle-only predicates', async () => {
    // Arrange
    const app = await createProbeApp(databaseUrl);
    const em = app.get(EntityManager);

    // Act
    const indexes: Array<{ indexname: string; indexdef: string }> = await em
      .getConnection()
      .execute(
        `SELECT indexname, indexdef FROM pg_indexes WHERE indexname IN (?, ?, ?) ORDER BY indexname`,
        [
          ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.nationalCodeActiveUnique,
          ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.phoneActiveUnique,
          ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.usernameActiveUnique,
        ],
      );

    // Assert — each identifier invariant indexes exactly its column and
    // predicates on persisted lifecycle status only (ADR-041/042): no now(),
    // no expires_at.
    expect(indexes).toHaveLength(3);
    const byName = new Map(indexes.map((index) => [index.indexname, index.indexdef]));
    for (const [name, column] of [
      [ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.phoneActiveUnique, 'phone_number'],
      [ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.nationalCodeActiveUnique, 'national_code'],
      [ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.usernameActiveUnique, 'username'],
    ] as const) {
      const indexdef = byName.get(name);
      expect(indexdef).toBeDefined();
      expect(indexdef).toContain('CREATE UNIQUE INDEX');
      expect(indexdef).toMatch(new RegExp(`USING btree \\(${column}\\)`));
      expect(indexdef).toContain("'EXPIRED'");
      expect(indexdef).not.toContain('now()');
    }
    expect(byName.get(ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.nationalCodeActiveUnique)).toContain(
      'national_code IS NOT NULL',
    );
    expect(byName.get(ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.usernameActiveUnique)).toContain(
      'username IS NOT NULL',
    );
    await app.close();
  });
});

describe('Enrollment persistence', () => {
  it('round-trips a persisted row: string BIGINT id, database-generated version-7 public_id, defaults, and the 24-hour expiry', async () => {
    // Arrange
    const app = await createProbeApp(databaseUrl);
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

  it('round-trips every step-data field with its approved representation (ADR-042)', async () => {
    // Arrange
    const app = await createProbeApp(databaseUrl);
    const em = app.get(EntityManager).fork();
    const enrollment = em.create(Enrollment, {
      phoneNumber: '09123456790',
      nationalCode: '0923456789',
      firstName: 'آرش',
      lastName: 'کامران',
      birthDate: '1991-09-06',
      referralCode: 'REF-42',
      username: 'arash.k',
      passwordHash: 'argon2id$dummy-hash-value',
      occupation: 'مهندس نرم‌افزار',
      videoKey: 'verification/arash-k-2026.mp4',
    });

    // Act
    await em.flush();
    const persisted = await em.findOneOrFail(Enrollment, { id: enrollment.id });
    const raw: Array<{
      national_code: string;
      first_name: string;
      last_name: string;
      birth_date: string | Date;
      referral_code: string;
      username: string;
      password_hash: string;
      occupation: string;
      video_key: string;
    }> = await em.getConnection().execute(
      `SELECT national_code, first_name, last_name, birth_date, referral_code,
              username, password_hash, occupation, video_key
         FROM enrollments WHERE id = ?`,
      [enrollment.id],
    );

    // Assert — national_code keeps its leading zero (varchar, not numeric);
    // birth_date round-trips as the Gregorian YYYY-MM-DD string the entity
    // carries (Jalali input converts at the Phase 6 application boundary).
    expect(persisted.nationalCode).toBe('0923456789');
    expect(persisted.firstName).toBe('آرش');
    expect(persisted.lastName).toBe('کامران');
    expect(persisted.birthDate).toBe('1991-09-06');
    expect(persisted.referralCode).toBe('REF-42');
    expect(persisted.username).toBe('arash.k');
    expect(persisted.passwordHash).toBe('argon2id$dummy-hash-value');
    expect(persisted.occupation).toBe('مهندس نرم‌افزار');
    expect(persisted.videoKey).toBe('verification/arash-k-2026.mp4');
    expect(raw[0].national_code).toBe('0923456789');
    expect(String(raw[0].birth_date)).toBe('1991-09-06');
    await app.close();
  });
});

describe('One-active-per-phone invariant (ADR-041)', () => {
  it('rejects a second active enrollment for the same phone number', async () => {
    // Arrange
    const app = await createProbeApp(databaseUrl);
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
    const app = await createProbeApp(databaseUrl);
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
    const app = await createProbeApp(databaseUrl);
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
    const app = await createProbeApp(databaseUrl);
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
    const app = await createProbeApp(databaseUrl);
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
    const app = await createProbeApp(databaseUrl);
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
    const app = await createProbeApp(databaseUrl);
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

describe('Lazy expiration persistence (master prompt §11.1)', () => {
  it('persists the expiration transition before the step rejection surfaces', async () => {
    // Arrange — a row already past its expires_at, driven through the real
    // state machine: the guards pass, the transition applies to the entity,
    // then the rejection throws (apply() never runs).
    const app = await createProbeApp(databaseUrl);
    const em = app.get(EntityManager).fork();
    const machine = app.get(EnrollmentStateMachine);
    const enrollment = em.create(Enrollment, {
      phoneNumber: '09120000041',
      expiresAt: new Date(Date.now() - 60_000),
    });
    await em.flush();
    const apply = vi.fn();

    // Act
    expect(() =>
      machine.executeStep(enrollment, ENROLLMENT_INITIAL_STEP, new Date(), apply),
    ).toThrowError(EnrollmentStateMachineError);

    // Assert — the expiration is already on the entity; flushing persists
    // it (the exception never rolled it back).
    expect(apply).not.toHaveBeenCalled();
    expect(enrollment.status).toBe(ENROLLMENT_STATUS_EXPIRED);
    await em.flush();
    const rows: Array<{ status: string }> = await em
      .getConnection()
      .execute(`SELECT status FROM enrollments WHERE phone_number = '09120000041'`);
    expect(rows[0].status).toBe(ENROLLMENT_STATUS_EXPIRED);
    await app.close();
  });

  it('releases the phone number once the lazy expiration is persisted', async () => {
    // Arrange
    const app = await createProbeApp(databaseUrl);
    const em = app.get(EntityManager).fork();
    const connection = app.get(EntityManager).getConnection();
    const machine = app.get(EnrollmentStateMachine);
    const enrollment = em.create(Enrollment, {
      phoneNumber: '09120000042',
      expiresAt: new Date(Date.now() - 60_000),
    });
    await em.flush();

    // Act — lazy-expire and persist, then claim the same phone again.
    machine.expireIfDue(enrollment, new Date());
    await em.flush();
    await insertEnrollment(connection, '09120000042');

    // Assert — the released phone carries one EXPIRED row and one active row.
    const counts: Array<{ status: string; total: string }> = await connection.execute(
      `SELECT status, count(*) AS total FROM enrollments WHERE phone_number = '09120000042' GROUP BY status`,
    );
    expect(counts.find((row) => row.status === ENROLLMENT_STATUS_EXPIRED)?.total).toBe('1');
    expect(counts.find((row) => row.status === 'INITIAL')?.total).toBe('1');
    await app.close();
  });
});

describe('Optimistic locking through the state machine (master prompt §11.2)', () => {
  it('maps a stale version to the VersionConflict contract', async () => {
    // Arrange — two forks hold the same row; fork A flushes a real update
    // first, so fork B's entity carries a stale version.
    const app = await createProbeApp(databaseUrl);
    const machine = app.get(EnrollmentStateMachine);
    const emA = app.get(EntityManager).fork();
    const emB = app.get(EntityManager).fork();
    const enrollment = emA.create(Enrollment, { phoneNumber: '09120000043' });
    await emA.flush();
    const stale = await emB.findOneOrFail(Enrollment, { id: enrollment.id });
    const fresh = await emA.findOneOrFail(Enrollment, { id: enrollment.id });
    fresh.firstName = 'آرش';
    await emA.flush();

    // Act — fork B runs the machine (state changes apply) and flushes with
    // the inherited version: the optimistic lock fails and the mapper
    // converts it to the established VersionConflict contract.
    machine.executeStep(stale, ENROLLMENT_INITIAL_STEP, new Date(), () => {
      stale.nationalCode = '0923456789';
    });
    let caught: unknown;
    try {
      await emB.lock(stale, LockMode.OPTIMISTIC, { lockVersion: stale.version });
      await emB.flush();
    } catch (error) {
      caught = error;
    }

    // Assert — the mapper rethrows the lock failure as a 409
    // VersionConflict; any other failure would surface unchanged.
    expect(caught).toBeDefined();
    expect(() => mapOptimisticLockError(caught, 'conflict detail')).toThrowError(AppHttpException);
    try {
      mapOptimisticLockError(caught, 'conflict detail');
    } catch (error) {
      if (!(error instanceof AppHttpException)) throw error;
      expect(error.code).toBe(ErrorCode.VersionConflict);
    }
    await app.close();
  });
});

describe('Identifier release invariants (ADR-042)', () => {
  it('rejects two active enrollments sharing a national code', async () => {
    // Arrange
    const app = await createProbeApp(databaseUrl);
    const connection = app.get(EntityManager).getConnection();
    await insertEnrollmentWithIdentity(connection, '09120000011', { nationalCode: '1234567890' });

    // Act & Assert
    await expect(
      insertEnrollmentWithIdentity(connection, '09120000012', { nationalCode: '1234567890' }),
    ).rejects.toThrowError(new RegExp(ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.nationalCodeActiveUnique));
    await app.close();
  });

  it('rejects two active enrollments sharing a username', async () => {
    // Arrange
    const app = await createProbeApp(databaseUrl);
    const connection = app.get(EntityManager).getConnection();
    await insertEnrollmentWithIdentity(connection, '09120000013', { username: 'shared.user' });

    // Act & Assert
    await expect(
      insertEnrollmentWithIdentity(connection, '09120000014', { username: 'shared.user' }),
    ).rejects.toThrowError(new RegExp(ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.usernameActiveUnique));
    await app.close();
  });

  it('never collides on NULL identity columns', async () => {
    // Arrange — two active rows with no identity values at all.
    const app = await createProbeApp(databaseUrl);
    const connection = app.get(EntityManager).getConnection();

    // Act
    await insertEnrollmentWithIdentity(connection, '09120000015', {});
    await insertEnrollmentWithIdentity(connection, '09120000016', {});

    // Assert — the IS NOT NULL predicates keep NULLs outside the unique
    // indexes (ADR-042).
    const rows: Array<{ total: string }> = await connection.execute(
      `SELECT count(*) AS total FROM enrollments WHERE phone_number IN ('09120000015', '09120000016')`,
    );
    expect(rows[0].total).toBe('2');
    await app.close();
  });

  it('an expired enrollment releases its national code and username', async () => {
    // Arrange
    const app = await createProbeApp(databaseUrl);
    const connection = app.get(EntityManager).getConnection();
    const identity = { nationalCode: '1234567891', username: 'released.user' };
    await insertEnrollmentWithIdentity(
      connection,
      '09120000017',
      identity,
      ENROLLMENT_STATUS_EXPIRED,
    );

    // Act
    await insertEnrollmentWithIdentity(
      connection,
      '09120000018',
      identity,
      ENROLLMENT_STATUS_EXPIRED,
    );
    await insertEnrollmentWithIdentity(connection, '09120000019', identity);

    // Assert — two EXPIRED rows and one active row coexist sharing both
    // identity values.
    const counts: Array<{ status: string; total: string }> = await connection.execute(
      `SELECT status, count(*) AS total FROM enrollments WHERE phone_number IN ('09120000017', '09120000018', '09120000019') GROUP BY status`,
    );
    expect(counts.find((row) => row.status === 'EXPIRED')?.total).toBe('2');
    expect(counts.find((row) => row.status === 'INITIAL')?.total).toBe('1');
    await app.close();
  });

  it('occupied statuses keep the identifiers claimed until expiry', async () => {
    // Arrange — every non-expired occupied status blocks a replacement.
    const app = await createProbeApp(databaseUrl);
    const connection = app.get(EntityManager).getConnection();
    // Derived from the single source: every non-expired status beyond
    // INITIAL occupies the identity pair (INITIAL occupation is proven by
    // the two sharing tests above).
    const occupiedStatuses = ENROLLMENT_STATUSES.filter(
      (status) => status !== ENROLLMENT_STATUS_EXPIRED && status !== ENROLLMENT_INITIAL_STATUS,
    );

    // Act & Assert
    for (const [index, status] of occupiedStatuses.entries()) {
      const identity = { nationalCode: `123456789${index + 2}`, username: `occupied${index}.user` };
      const phone = `0912000300${index + 1}`;
      await insertEnrollmentWithIdentity(connection, phone, identity, status);
      await expect(
        insertEnrollmentWithIdentity(connection, `0912000200${index + 1}`, identity),
      ).rejects.toThrowError(
        // The identity pair collides in both indexes; PostgreSQL reports
        // whichever unique check fires first, so either proves occupation.
        new RegExp(
          `${ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.nationalCodeActiveUnique}|${ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.usernameActiveUnique}`,
        ),
      );
    }
    await app.close();
  });
});

describe('Step-data column contracts (ADR-042)', () => {
  it('rejects a national code outside the 10-digit format', async () => {
    // Arrange
    const app = await createProbeApp(databaseUrl);
    const connection = app.get(EntityManager).getConnection();

    // Act & Assert — varchar(10) rejects over-length input; the format
    // CHECK rejects short or non-digit values (ADR-042).
    await expect(
      insertEnrollmentWithIdentity(connection, '09120000021', { nationalCode: '12345678901' }),
    ).rejects.toThrowError(/value too long for type character varying\(10\)/);
    await expect(
      insertEnrollmentWithIdentity(connection, '09120000022', { nationalCode: '12345' }),
    ).rejects.toThrowError(new RegExp(ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.nationalCodeFormat));
    await expect(
      insertEnrollmentWithIdentity(connection, '09120000023', { nationalCode: '123456789X' }),
    ).rejects.toThrowError(new RegExp(ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.nationalCodeFormat));
    await app.close();
  });

  it('rejects usernames outside the canonical charset or range', async () => {
    // Arrange
    const app = await createProbeApp(databaseUrl);
    const connection = app.get(EntityManager).getConnection();

    // Act & Assert — the CHECK enforces the lowercase charset and the
    // 3–30 length window; uppercase input is rejected, not folded.
    await expect(
      insertEnrollmentWithIdentity(connection, '09120000024', { username: 'Arash.K' }),
    ).rejects.toThrowError(new RegExp(ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.usernameFormat));
    await expect(
      insertEnrollmentWithIdentity(connection, '09120000025', { username: 'ab' }),
    ).rejects.toThrowError(new RegExp(ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.usernameFormat));
    await expect(
      insertEnrollmentWithIdentity(connection, '09120000026', { username: 'a'.repeat(31) }),
    ).rejects.toThrowError(new RegExp(ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.usernameFormat));
    await expect(
      insertEnrollmentWithIdentity(connection, '09120000027', { username: 'arash k' }),
    ).rejects.toThrowError(new RegExp(ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.usernameFormat));
    await app.close();
  });

  it('rejects prose over the approved length contracts', async () => {
    // Arrange
    const app = await createProbeApp(databaseUrl);
    const connection = app.get(EntityManager).getConnection();
    const violations = [
      {
        name: ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.firstNameLength,
        values: ['x'.repeat(51), 'ok', 'ok', 'ok', 'ok'],
      },
      {
        name: ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.lastNameLength,
        values: ['ok', 'x'.repeat(51), 'ok', 'ok', 'ok'],
      },
      {
        name: ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.referralCodeLength,
        values: ['ok', 'ok', 'x'.repeat(21), 'ok', 'ok'],
      },
      {
        name: ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.occupationLength,
        values: ['ok', 'ok', 'ok', 'x'.repeat(101), 'ok'],
      },
      {
        name: ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.videoKeyLength,
        values: ['ok', 'ok', 'ok', 'ok', 'x'.repeat(501)],
      },
    ];

    // Act & Assert — each case over-lengths exactly one prose column.
    for (const [index, violation] of violations.entries()) {
      await expect(
        connection.execute(INSERT_ENROLLMENT_PROSE, [`0912000400${index}`, ...violation.values]),
      ).rejects.toThrowError(new RegExp(violation.name));
    }
    await app.close();
  });

  it('lets birth_date reject impossible calendar dates natively', async () => {
    // Arrange
    const app = await createProbeApp(databaseUrl);
    const connection = app.get(EntityManager).getConnection();

    // Act & Assert — month 13 does not exist; PostgreSQL date validity is
    // the contract (ADR-042).
    await expect(
      connection.execute(INSERT_ENROLLMENT_WITH_BIRTH_DATE, ['09120000032', '1370-13-01']),
    ).rejects.toThrowError(/date\/time field value out of range/);
    await app.close();
  });
});
