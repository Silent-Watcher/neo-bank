import { Entity, Property, ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { MikroORM } from '@mikro-orm/core';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BaseEntity } from './base.entity.js';

// Spec-local twin of the db-tier fixture: same shape, so metadata assertions
// and physical schema assertions stay independent.
@Entity()
class MetadataTestArticle extends BaseEntity {
  @Property({ type: 'string', length: 120 })
  title!: string;
}

// Metadata-level verification of the BaseEntity convention (ADR-029/030):
// discovery assertions run without a database — the physical schema shape is
// proven against real PostgreSQL in test/base-entity.db-spec.ts.

let orm: MikroORM;

beforeAll(async () => {
  orm = await MikroORM.init({
    driver: PostgreSqlDriver,
    // v7 initializes without connecting (ADR-027) — no connection is opened
    // here; real persistence is proven by the db tier instead.
    dbName: 'metadata-verification',
    metadataProvider: ReflectMetadataProvider,
    entities: [BaseEntity, MetadataTestArticle],
  });
});

afterAll(async () => {
  await orm.close(true);
});

describe('BaseEntity metadata (ADR-029)', () => {
  it('marks the base abstract so it generates no table, and inlines its properties into concrete entities', () => {
    // Arrange
    const metadata = orm.em.getMetadata();
    const article = metadata.get(MetadataTestArticle);

    // Act & Assert — the abstract base is absorbed during discovery: it is
    // not a discoverable entity of its own and carries no table.
    expect(metadata.find(BaseEntity)).toBeUndefined();
    for (const name of [
      'id',
      'createdAt',
      'updatedAt',
      'createdBy',
      'updatedBy',
      'version',
      'deletedAt',
    ] as const) {
      expect(article.properties[name]).toBeDefined();
    }
    expect(article.collection).toBe('metadata_test_article');
  });

  it('declares a string-typed autoincrement BIGINT primary key', () => {
    // Arrange
    const id = orm.em.getMetadata().get(MetadataTestArticle).properties['id'];

    // Act & Assert
    expect(id.primary).toBe(true);
    expect(id.autoincrement).toBe(true);
    expect(id.runtimeType).toBe('string');
    expect(id.columnTypes[0]).toBe('bigserial');
  });

  it('maps timestamps to TIMESTAMPTZ(3) with the required nullability and lifecycle callbacks', () => {
    // Arrange
    const properties = orm.em.getMetadata().get(MetadataTestArticle).properties;

    // Act & Assert — v7 discovery leaves `nullable` undefined on
    // non-nullable properties (NOT NULL is the absence of the flag).
    expect(properties['createdAt'].columnTypes[0]).toBe('timestamptz(3)');
    expect(properties['createdAt'].nullable ?? false).toBe(false);
    expect(typeof properties['createdAt'].onCreate).toBe('function');
    expect(properties['updatedAt'].columnTypes[0]).toBe('timestamptz(3)');
    expect(properties['updatedAt'].nullable).toBe(true);
    expect(typeof properties['updatedAt'].onUpdate).toBe('function');
    expect(properties['deletedAt'].columnTypes[0]).toBe('timestamptz(3)');
    expect(properties['deletedAt'].nullable).toBe(true);
    expect(properties['deletedAt'].onCreate).toBeUndefined();
    expect(properties['deletedAt'].onUpdate).toBeUndefined();
  });

  it('maps audit identifiers to nullable bigint scalars without relations', () => {
    // Arrange
    const properties = orm.em.getMetadata().get(MetadataTestArticle).properties;

    // Act & Assert
    for (const name of ['createdBy', 'updatedBy'] as const) {
      expect(properties[name].columnTypes[0]).toBe('bigint');
      expect(properties[name].nullable).toBe(true);
      expect(properties[name].runtimeType).toBe('string');
      expect(properties[name].kind).toBe('scalar');
    }
  });

  it('owns the optimistic-locking version property and propagates the base check constraint', () => {
    // Arrange
    const metadata = orm.em.getMetadata();
    const article = metadata.get(MetadataTestArticle);

    // Act & Assert
    expect(article.versionProperty).toBe('version');
    expect(article.properties['version'].version).toBe(true);
    expect(article.checks.some((check) => check.name === 'base_entity_id_positive')).toBe(true);
  });
});
