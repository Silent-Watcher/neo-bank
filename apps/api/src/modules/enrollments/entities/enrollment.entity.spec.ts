import { Entity, Property, ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { MikroORM } from '@mikro-orm/core';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BaseEntity } from '#database/base.entity.js';

import { Enrollment } from './enrollment.entity.js';

// Spec-local twin of the metadata fixture pattern from base.entity.spec.ts:
// metadata-level verification without a database — the physical schema shape
// is proven against real PostgreSQL in test/enrollment.db-spec.ts.

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

  it('declares phoneNumber as its only own property', () => {
    // Arrange
    const enrollment = orm.em.getMetadata().get(Enrollment);
    const base = orm.em.getMetadata().get(MetadataProbeEntity);
    const inherited = new Set(Object.keys(base.properties));

    // Act
    const own = Object.keys(enrollment.properties).filter((name) => !inherited.has(name));

    // Assert — the inherited set is inlined and phoneNumber is the sole
    // addition; no inherited property is redeclared as a distinct definition.
    expect(own).toEqual(['phoneNumber']);
  });

  it('stores phoneNumber as a non-null snake_case varchar column without lifecycle callbacks', () => {
    // Arrange
    const phoneNumber = orm.em.getMetadata().get(Enrollment).properties['phoneNumber'];

    // Act & Assert
    expect(phoneNumber.fieldNames).toEqual(['phone_number']);
    expect(phoneNumber.columnTypes[0]).toBe('varchar(255)');
    expect(phoneNumber.runtimeType).toBe('string');
    expect(phoneNumber.nullable ?? false).toBe(false);
    expect(phoneNumber.onCreate).toBeUndefined();
    expect(phoneNumber.onUpdate).toBeUndefined();
  });

  it('inlines the inherited BaseEntity columns into the enrollments table', () => {
    // Arrange
    const properties = orm.em.getMetadata().get(Enrollment).properties;

    // Act & Assert
    for (const name of [
      'id',
      'createdAt',
      'updatedAt',
      'createdBy',
      'updatedBy',
      'version',
      'deletedAt',
    ] as const) {
      expect(properties[name]).toBeDefined();
    }
    expect(properties['id'].columnTypes[0]).toBe('bigserial');
    expect(properties['id'].runtimeType).toBe('string');
    expect(properties['version'].version).toBe(true);
  });
});
