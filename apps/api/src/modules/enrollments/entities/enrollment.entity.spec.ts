import { Entity, Property, ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { MikroORM } from '@mikro-orm/core';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BaseEntity } from '#database/base.entity.js';
import {
  ENROLLMENT_INITIAL_STATUS,
  ENROLLMENT_INITIAL_STEP,
  ENROLLMENT_SCHEMA_CONSTRAINT_NAMES,
} from '#modules/enrollments/enrollments.enums.js';

import { Enrollment } from './enrollment.entity.js';

// Spec-local twin of the metadata fixture pattern from base.entity.spec.ts:
// metadata-level verification without a database — the physical schema shape
// (columns, checks, unique index, constraint behavior) is proven against real
// PostgreSQL in test/enrollment.db-spec.ts.

@Entity()
class MetadataProbeEntity extends BaseEntity {
  @Property({ type: 'string' })
  fill!: string;
}

let orm: MikroORM;

beforeAll(async () => {
  orm = await MikroORM.init({
    driver: PostgreSqlDriver,
    // v7 initializes without connecting (ADR-027) — no connection is opened.
    dbName: 'metadata-verification',
    metadataProvider: ReflectMetadataProvider,
    entities: [BaseEntity, MetadataProbeEntity, Enrollment],
  });
});

afterAll(async () => {
  await orm.close(true);
});

describe('Enrollment metadata', () => {
  it('extends the shared BaseEntity and generates no BaseEntity table', () => {
    // Arrange
    const metadata = orm.em.getMetadata();

    // Act & Assert
    expect(Object.getPrototypeOf(Enrollment)).toBe(BaseEntity);
    expect(metadata.find(BaseEntity)).toBeUndefined();
    expect(metadata.get(Enrollment)).toBeDefined();
  });

  it('maps to the enrollments table', () => {
    // Arrange
    const enrollment = orm.em.getMetadata().get(Enrollment);

    // Act & Assert
    expect(enrollment.collection).toBe('enrollments');
  });

  it('adds exactly the approved core lifecycle and step-data properties to the inherited base columns', () => {
    // Arrange
    const enrollment = orm.em.getMetadata().get(Enrollment);
    const base = orm.em.getMetadata().get(MetadataProbeEntity);
    const inherited = new Set(Object.keys(base.properties));

    // Act
    const own = Object.keys(enrollment.properties).filter((name) => !inherited.has(name));

    // Assert — the inherited set is inlined and these are the sole additions
    // (ADR-041 core data model + ADR-042 step data); no inherited property is
    // redeclared as a distinct definition.
    expect(own).toEqual([
      'phoneNumber',
      'publicId',
      'status',
      'currentStep',
      'expiresAt',
      'nationalCode',
      'firstName',
      'lastName',
      'birthDate',
      'referralCode',
      'username',
      'passwordHash',
      'occupation',
      'videoKey',
    ]);
  });

  it('maps every step-data field as nullable with its approved type contract (ADR-042)', () => {
    // Arrange
    const properties = orm.em.getMetadata().get(Enrollment).properties;

    // Act & Assert — fixed-format identifiers get exact varchar(n); prose
    // gets text; birthDate is a native date column carrying YYYY-MM-DD
    // strings; all nullable, none with database defaults.
    expect(properties['nationalCode'].columnTypes[0]).toBe('varchar(10)');
    expect(properties['nationalCode'].nullable ?? false).toBe(true);
    expect(properties['firstName'].columnTypes[0]).toBe('text');
    expect(properties['lastName'].columnTypes[0]).toBe('text');
    expect(properties['birthDate'].columnTypes[0]).toBe('date');
    expect(properties['birthDate'].runtimeType).toBe('string');
    expect(properties['referralCode'].columnTypes[0]).toBe('text');
    expect(properties['username'].columnTypes[0]).toBe('text');
    expect(properties['passwordHash'].columnTypes[0]).toBe('text');
    expect(properties['occupation'].columnTypes[0]).toBe('text');
    expect(properties['videoKey'].columnTypes[0]).toBe('text');
    for (const name of [
      'nationalCode',
      'firstName',
      'lastName',
      'birthDate',
      'referralCode',
      'username',
      'passwordHash',
      'occupation',
      'videoKey',
    ] as const) {
      expect(properties[name].defaultRaw).toBeUndefined();
      expect(properties[name].default).toBeUndefined();
    }
  });

  it('stores phoneNumber as the canonical national-format varchar(11)', () => {
    // Arrange
    const phoneNumber = orm.em.getMetadata().get(Enrollment).properties['phoneNumber'];

    // Act & Assert
    expect(phoneNumber.fieldNames).toEqual(['phone_number']);
    expect(phoneNumber.columnTypes[0]).toBe('varchar(11)');
    expect(phoneNumber.runtimeType).toBe('string');
    expect(phoneNumber.nullable ?? false).toBe(false);
    expect(phoneNumber.onCreate).toBeUndefined();
    expect(phoneNumber.onUpdate).toBeUndefined();
  });

  it('maps publicId to a uuid column with the database-native uuidv7() default', () => {
    // Arrange
    const publicId = orm.em.getMetadata().get(Enrollment).properties['publicId'];

    // Act & Assert — the application never generates the identifier
    // (ADR-040/041): the column carries the database default and the driver
    // reads the generated value back after insert.
    expect(publicId.fieldNames).toEqual(['public_id']);
    expect(publicId.columnTypes[0]).toBe('uuid');
    expect(publicId.runtimeType).toBe('string');
    expect(publicId.nullable ?? false).toBe(false);
    expect(publicId.defaultRaw).toBe('uuidv7()');
  });

  it('defaults status and currentStep from the single-source enums', () => {
    // Arrange
    const properties = orm.em.getMetadata().get(Enrollment).properties;

    // Act & Assert — text carries the value contract via CHECK constraints
    // (ADR-041 amendment); no arbitrary length limit.
    expect(properties['status'].columnTypes[0]).toBe('text');
    expect(properties['status'].default).toBe(ENROLLMENT_INITIAL_STATUS);
    expect(properties['currentStep'].columnTypes[0]).toBe('text');
    expect(properties['currentStep'].default).toBe(ENROLLMENT_INITIAL_STEP);
  });

  it('maps expiresAt as a non-null timestamptz(3) without any database default', () => {
    // Arrange
    const expiresAt = orm.em.getMetadata().get(Enrollment).properties['expiresAt'];

    // Act & Assert — the one-clock-reading rule (ADR-041): the value comes
    // from the same application clock as createdAt, never from the database.
    expect(expiresAt.fieldNames).toEqual(['expires_at']);
    expect(expiresAt.columnTypes[0]).toBe('timestamptz(3)');
    expect(expiresAt.nullable ?? false).toBe(false);
    expect(expiresAt.defaultRaw).toBeUndefined();
    expect(expiresAt.default).toBeUndefined();
  });

  it('declares the enrollment check constraints from the single-source enums', () => {
    // Arrange
    const checks = orm.em.getMetadata().get(Enrollment).checks;

    // Act
    const names = checks.map((check) => check.name);

    // Assert
    expect(names).toEqual(
      expect.arrayContaining([
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
      ]),
    );
  });

  it('declares the partial unique identifier indexes and the public_id unique constraint', () => {
    // Arrange
    const uniques = orm.em.getMetadata().get(Enrollment).uniques;

    // Act
    const byName = new Map(uniques.map((unique) => [unique.name, unique]));

    // Assert — the one-active-per-phone invariant indexes exactly the phone
    // column (a composite unique would weaken it) and predicates on
    // persisted lifecycle status only (ADR-041); the national code and
    // username follow the same release semantics (ADR-042).
    expect(byName.get(ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.phoneActiveUnique)).toMatchObject({
      properties: ['phoneNumber'],
    });
    expect(
      String(byName.get(ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.phoneActiveUnique)?.where ?? ''),
    ).toContain("status <> 'EXPIRED'");
    expect(byName.get(ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.publicIdUnique)).toMatchObject({
      properties: ['publicId'],
    });
    expect(byName.get(ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.nationalCodeActiveUnique)).toMatchObject({
      properties: ['nationalCode'],
    });
    expect(
      String(byName.get(ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.nationalCodeActiveUnique)?.where ?? ''),
    ).toContain("national_code IS NOT NULL AND status <> 'EXPIRED'");
    expect(byName.get(ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.usernameActiveUnique)).toMatchObject({
      properties: ['username'],
    });
    expect(
      String(byName.get(ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.usernameActiveUnique)?.where ?? ''),
    ).toContain("username IS NOT NULL AND status <> 'EXPIRED'");
  });
});
