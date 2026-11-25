import { readdirSync } from 'node:fs';

import { MikroORM } from '@mikro-orm/core';
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BaseEntity } from '#database/base.entity.js';
import { Enrollment } from '#modules/enrollments/entities/enrollment.entity.js';
import { ENROLLMENT_SCHEMA_CONSTRAINT_NAMES } from '#modules/enrollments/enrollments.enums.js';
import { Migration20261116181139 } from '#database/migrations/Migration20261116181139.js';
import { Migration20261122000737 } from '#database/migrations/Migration20261122000737.js';
import { Migration20261122011051 } from '#database/migrations/Migration20261122011051.js';
import { Migration20261124182507 } from '#database/migrations/Migration20261124182507.js';
import { Migration20261125220000 } from '#database/migrations/Migration20261125220000.js';

import { startTestPostgres } from './testcontainers.js';
import type { TestPostgres } from './testcontainers.js';

// Migration-replay parity tier (DEFERRED _060 entry 1, implemented in Phase
// 3 per ADR-042): replays every migration from zero against a fresh
// Testcontainers PostgreSQL through the real Migrator and asserts the same
// schema shape the metadata tier (schema.create()-built specs) asserts —
// closing the entity↔migration gap mechanically on every run instead of
// relying on review.

let postgres: TestPostgres;
let databaseUrl: string;
let orm: MikroORM;

// The programmatic equivalent of the CLI's migration discovery (ADR-033):
// explicit classes, no snapshot, no filesystem globs. The first parity test
// asserts this list matches the migration files on disk.
const MIGRATIONS_LIST = [
  { name: 'Migration20261116181139', class: Migration20261116181139 },
  { name: 'Migration20261122000737', class: Migration20261122000737 },
  { name: 'Migration20261122011051', class: Migration20261122011051 },
  { name: 'Migration20261124182507', class: Migration20261124182507 },
  { name: 'Migration20261125220000', class: Migration20261125220000 },
];

beforeAll(async () => {
  ({ postgres, url: databaseUrl } = await startTestPostgres());
  orm = await MikroORM.init({
    driver: PostgreSqlDriver,
    clientUrl: databaseUrl,
    metadataProvider: ReflectMetadataProvider,
    entities: [BaseEntity, Enrollment],
    // Snapshot generation is disabled: the replay owns no snapshot, and
    // without a migrations path the Migrator would write `.snapshot-<db>`
    // relative to the CWD on every run — the CLI owns the real snapshot
    // next to the migrations (ADR-033).
    migrations: { migrationsList: MIGRATIONS_LIST, snapshot: false },
  });
  await orm.migrator.up();
});

afterAll(async () => {
  await orm.close(true);
  await postgres.stop();
});

describe('Migration replay parity', () => {
  it('covers every migration file on disk (no silent list drift)', () => {
    // Arrange — the explicit list must name exactly the migration files in
    // the migrations directory (ADR-033): a new migration added without
    // updating this spec fails here instead of silently leaving the replay
    // tier under-covering.
    const fileNames = readdirSync('src/shared/database/migrations')
      .filter((file) => /^Migration.*\.ts$/.test(file))
      .sort();

    // Act & Assert
    expect(fileNames).toEqual(MIGRATIONS_LIST.map((migration) => `${migration.name}.ts`).sort());
  });

  it('applies every migration to the latest version', async () => {
    // Arrange
    const pending = await orm.migrator.getPending();

    // Act & Assert
    expect(pending).toHaveLength(0);
  });

  it('reaches the same column shape the metadata tier asserts', async () => {
    // Arrange
    const connection = orm.em.getConnection();

    // Act
    const columns: Array<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }> = await connection.execute(
      `SELECT column_name, data_type, is_nullable, column_default
           FROM information_schema.columns
          WHERE table_name = 'enrollments'
          ORDER BY ordinal_position`,
    );

    // Act & Assert — full ADR-041 + ADR-042 column set with the approved
    // types and nullability (information_schema spelling).
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
    expect(byName.get('public_id')).toMatchObject({
      data_type: 'uuid',
      is_nullable: 'NO',
      column_default: expect.stringContaining('uuidv7()'),
    });
    expect(byName.get('status')).toMatchObject({
      data_type: 'text',
      is_nullable: 'NO',
      column_default: expect.stringContaining('INITIAL'),
    });
    expect(byName.get('current_step')).toMatchObject({
      data_type: 'text',
      is_nullable: 'NO',
      column_default: expect.stringContaining('NATIONAL_CODE'),
    });
    expect(byName.get('expires_at')).toMatchObject({
      data_type: 'timestamp with time zone',
      is_nullable: 'NO',
      column_default: null,
    });
    expect(byName.get('national_code')).toMatchObject({
      data_type: 'character varying',
      is_nullable: 'YES',
    });
    expect(byName.get('first_name')).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    expect(byName.get('last_name')).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    expect(byName.get('referral_code')).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    expect(byName.get('birth_date')).toMatchObject({ data_type: 'date', is_nullable: 'YES' });
    expect(byName.get('username')).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    expect(byName.get('password_hash')).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    expect(byName.get('occupation')).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    expect(byName.get('video_key')).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
  });

  it('reaches the same constraints and identifier indexes the metadata tier asserts', async () => {
    // Arrange
    const connection = orm.em.getConnection();

    // Act
    const checks: Array<{ conname: string }> = await connection.execute(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'enrollments'::regclass AND contype = 'c'`,
    );
    const uniques: Array<{ conname: string }> = await connection.execute(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'enrollments'::regclass AND contype = 'u'`,
    );
    const indexes: Array<{ indexname: string; indexdef: string }> = await connection.execute(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE indexname IN (?, ?, ?) ORDER BY indexname`,
      [
        ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.nationalCodeActiveUnique,
        ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.phoneActiveUnique,
        ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.usernameActiveUnique,
      ],
    );

    // Assert
    const checkNames = checks.map((check) => check.conname);
    for (const name of [
      'base_entity_id_positive',
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
      expect(checkNames).toContain(name);
    }
    const uniqueNames = uniques.map((unique) => unique.conname);
    expect(uniqueNames).toContain(ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.publicIdUnique);
    expect(uniqueNames).toHaveLength(1);
    expect(indexes).toHaveLength(3);
    const byName = new Map(indexes.map((index) => [index.indexname, index.indexdef]));
    for (const [name, column] of [
      [ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.phoneActiveUnique, 'phone_number'],
      [ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.nationalCodeActiveUnique, 'national_code'],
      [ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.usernameActiveUnique, 'username'],
    ] as const) {
      const indexdef = byName.get(name);
      expect(indexdef).toContain('CREATE UNIQUE INDEX');
      expect(indexdef).toMatch(new RegExp(`USING btree \\(${column}\\)`));
      expect(indexdef).toContain("'EXPIRED'");
      expect(indexdef).not.toContain('now()');
    }
  });
});
