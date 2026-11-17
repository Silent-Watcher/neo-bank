import { EntityManager, MikroORM } from '@mikro-orm/core';
import { MIKRO_ORM_MODULE_OPTIONS } from '@mikro-orm/nestjs';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestNodeApplication } from '@nestjs/platform-node';

import { BaseEntity } from '#database/base.entity.js';
import {
  buildRuntimeMikroOrmOptions,
  DATABASE_POOL_MAX_DEFAULT,
} from '#database/mikro-orm.options.js';
import { Enrollment } from '#modules/enrollments/entities/enrollment.entity.js';
import { runWithActorContext } from '#src/shared/actor-context/actor-context.js';

import { createTestApp } from './create-test-app.js';
import { TestArticleController } from './fixtures/test-article.controller.js';
import { TestArticle } from './fixtures/test-article.entity.js';
import { startTestPostgres, type TestPostgres } from './testcontainers.js';

// BaseEntity integration tier (ADR-029/030): drives a test-only fixture
// entity through the real AppModule against its own Testcontainers
// PostgreSQL container. Redis keeps the validation-only placeholder from
// env/.env.db-test, so the throttler storage is swapped for the official
// in-memory service — probe routes must not depend on Redis here.

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

function createProbeApp(): Promise<NestNodeApplication> {
  return createTestApp(undefined, {
    controllers: [TestArticleController],
    configureModule: (builder) => {
      // The ORM options themselves are supplied (not the DATABASE_CONFIG
      // namespace token — ConfigService holds the registerAs factory result
      // and does not observe provider overrides on it). The fixture entity
      // rides in the explicit entities list; per the MikroORM rule for
      // explicit entities, its abstract base is listed alongside it.
      // Enrollment must ride in too: the real EnrollmentsModule registers
      // forFeature([Enrollment]), and with autoLoadEntities off its
      // repository provider resolves eagerly against the explicit list.
      // autoLoadEntities must stay off here: with it on, @mikro-orm/nestjs
      // copies the forFeature registrations into `entitiesTs`, and TS-mode
      // discovery (Vitest) uses `entitiesTs` INSTEAD of `entities` — the
      // explicit fixture list would be silently ignored.
      builder.overrideProvider(MIKRO_ORM_MODULE_OPTIONS).useValue({
        driver: PostgreSqlDriver,
        ...buildRuntimeMikroOrmOptions(databaseUrl, DATABASE_POOL_MAX_DEFAULT),
        entities: [BaseEntity, TestArticle, Enrollment],
        autoLoadEntities: false,
      });
      // Probe routes are guarded by the global throttler, which would
      // contact the placeholder Redis; the official in-memory storage keeps
      // the guard functional without Redis.
      builder.overrideProvider(ThrottlerStorage).useValue(new ThrottlerStorageService());
    },
  });
}

function probe(app: NestNodeApplication) {
  return request(app.getHttpServer());
}

describe('BaseEntity schema shape (ADR-029/030)', () => {
  it('configures PostgreSQL in UTC', async () => {
    // Arrange
    const app = await createProbeApp();
    const em = app.get(EntityManager);

    // Act
    const rows: Array<{ time_zone: string }> = await em.getConnection().execute('SHOW TimeZone');

    // Assert
    expect(Object.values(rows[0])[0]).toBe('UTC');
    await app.close();
  });

  it('creates the concrete table with the base entity columns and no base_entity table', async () => {
    // Arrange
    const app = await createProbeApp();
    const em = app.get(EntityManager);

    // Act
    const tables: Array<{ table_name: string }> = await em
      .getConnection()
      .execute(`SELECT table_name FROM information_schema.tables WHERE table_name = 'base_entity'`);
    const columns: Array<{
      column_name: string;
      data_type: string;
      datetime_precision: number | null;
      is_nullable: string;
      column_default: string | null;
    }> = await em.getConnection().execute(
      `SELECT column_name, data_type, datetime_precision, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_name = 'test_article'
         ORDER BY ordinal_position`,
    );

    // Assert — the abstract base generates no table of its own.
    expect(tables).toHaveLength(0);
    const byName = new Map(columns.map((column) => [column.column_name, column]));
    expect(byName.get('id')).toMatchObject({ data_type: 'bigint', is_nullable: 'NO' });
    expect(byName.get('id')?.column_default).toContain('nextval');
    for (const timestampColumn of ['created_at', 'updated_at', 'deleted_at']) {
      expect(byName.get(timestampColumn)).toMatchObject({
        data_type: 'timestamp with time zone',
        datetime_precision: 3,
      });
    }
    expect(byName.get('created_at')?.is_nullable).toBe('NO');
    for (const auditColumn of ['updated_at', 'created_by', 'updated_by', 'deleted_at']) {
      expect(byName.get(auditColumn)?.is_nullable).toBe('YES');
    }
    expect(byName.get('created_by')).toMatchObject({ data_type: 'bigint' });
    expect(byName.get('updated_by')).toMatchObject({ data_type: 'bigint' });
    expect(byName.get('version')).toMatchObject({
      data_type: 'integer',
      is_nullable: 'NO',
      column_default: '1',
    });
    await app.close();
  });

  it('declares the positive-identifier check, the primary key, and no foreign keys for audit columns', async () => {
    // Arrange
    const app = await createProbeApp();
    const em = app.get(EntityManager);

    // Act
    const constraints: Array<{ contype: string; conname: string }> = await em
      .getConnection()
      .execute(
        `SELECT contype::text AS contype, conname FROM pg_constraint WHERE conrelid = 'test_article'::regclass`,
      );

    // Assert
    expect(
      constraints.some(
        (constraint) =>
          constraint.conname === 'base_entity_id_positive' && constraint.contype === 'c',
      ),
    ).toBe(true);
    expect(constraints.some((constraint) => constraint.contype === 'p')).toBe(true);
    expect(constraints.filter((constraint) => constraint.contype === 'f')).toHaveLength(0);
    await app.close();
  });

  it('rejects non-positive identifiers through the check constraint', async () => {
    // Arrange
    const app = await createProbeApp();
    const em = app.get(EntityManager);

    // Act & Assert
    await expect(
      em
        .getConnection()
        .execute(
          `INSERT INTO test_article (id, title, version, created_at) VALUES (0, 'bad', 1, now())`,
        ),
    ).rejects.toThrow(/check constraint/i);
    await app.close();
  });
});

describe('BaseEntity lifecycle (ADR-029)', () => {
  it('persists creation defaults: createdAt set, updatedAt NULL, no actor, version 1, deletedAt NULL, string id', async () => {
    // Arrange
    const app = await createProbeApp();

    // Act
    const response = await probe(app).post('/api/v1/test/articles').send({ title: 'first' });

    // Assert
    expect(response.status).toBe(201);
    const article = response.body.data;
    expect(typeof article.id).toBe('string');
    expect(Number.isNaN(Number(article.id))).toBe(false);
    expect(typeof article.createdAt).toBe('string');
    expect(new Date(article.createdAt).getTime()).not.toBeNaN();
    expect(article.updatedAt).toBeNull();
    expect(article.createdBy).toBeNull();
    expect(article.updatedBy).toBeNull();
    expect(article.version).toBe(1);
    expect(article.deletedAt).toBeNull();
    await app.close();
  });

  it('bumps updatedAt and version on update while createdAt and createdBy stay unchanged', async () => {
    // Arrange
    const app = await createProbeApp();
    const created = await probe(app).post('/api/v1/test/articles').send({ title: 'v1' });

    // Act
    const updated = await probe(app)
      .put(`/api/v1/test/articles/${created.body.data.id}`)
      .send({ title: 'v2' });

    // Assert
    expect(updated.status).toBe(200);
    expect(updated.body.data.createdAt).toBe(created.body.data.createdAt);
    expect(updated.body.data.updatedAt).not.toBeNull();
    expect(new Date(updated.body.data.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(created.body.data.createdAt).getTime(),
    );
    expect(updated.body.data.version).toBe(2);
    expect(updated.body.data.createdBy).toBeNull();
    expect(updated.body.data.updatedBy).toBeNull();
    expect(updated.body.data.deletedAt).toBeNull();
    await app.close();
  });

  it('round-trips timestamps as absolute instants without shifts', async () => {
    // Arrange
    const app = await createProbeApp();
    const created = await probe(app).post('/api/v1/test/articles').send({ title: 'roundtrip' });
    // Outside an HTTP request there is no RequestContext fork, so the global
    // EM would throw; fork explicitly for the entity read.
    const em = app.get(EntityManager).fork();

    // Act — the same row read as an entity Date and as the raw driver string.
    // The raw SQL uses `?` placeholders; the connection converts them to the
    // platform's positional parameters ($1, $2, …) on PostgreSQL.
    const rows: Array<{ created_at: string }> = await em
      .getConnection()
      .execute(`SELECT created_at FROM test_article WHERE id = ?`, [created.body.data.id]);
    const entity = await em.findOneOrFail(TestArticle, { id: created.body.data.id });

    // Assert — the hydrated instant equals the stored instant.
    expect(entity.createdAt.getTime()).toBe(Date.parse(rows[0].created_at));
    await app.close();
  });
});

describe('Actor attribution (ADR-029)', () => {
  it('attributes creation and update to the actor of the current context, exact beyond MAX_SAFE_INTEGER', async () => {
    // Arrange
    const app = await createProbeApp();
    const actorId = '9007199254740993'; // 2^53 + 1 — impossible as a JS number
    const http = probe(app);

    // Act
    const created = await http
      .post('/api/v1/test/articles')
      .send({ title: 'audit', actingAs: actorId });
    const updated = await http
      .put(`/api/v1/test/articles/${created.body.data.id}`)
      .send({ title: 'audit2', actingAs: actorId });

    // Assert
    expect(created.body.data.createdBy).toBe(actorId);
    expect(created.body.data.updatedBy).toBeNull();
    expect(updated.body.data.createdBy).toBe(actorId);
    expect(updated.body.data.updatedBy).toBe(actorId);
    await app.close();
  });

  it('isolates concurrent actor contexts so attribution never leaks between chains', async () => {
    // Arrange
    const app = await createProbeApp();
    const em = app.get(EntityManager);
    const firstActor = '9007199254740991';
    const secondActor = '9007199254740992';

    // Act — two concurrent write chains inside different actor contexts, each
    // on its own EntityManager fork (outside HTTP requests there is no
    // request-scoped EM; a shared fork would let one chain's create land in
    // the other's in-flight flush).
    const [first, second] = await Promise.all([
      runWithActor(em, firstActor),
      runWithActor(em, secondActor),
    ]);

    // Assert
    expect(first.createdBy).toBe(firstActor);
    expect(second.createdBy).toBe(secondActor);
    await app.close();

    async function runWithActor(
      em: EntityManager,
      actorId: string,
    ): Promise<{ createdBy: string | null }> {
      return runWithActorContext({ actorId }, async () => {
        const forked = em.fork();
        const article = forked.create(TestArticle, { title: `concurrent-${actorId}` });
        await forked.flush();
        await new Promise((resolve) => setTimeout(resolve, 10));
        return article;
      });
    }
  });
});

describe('Request contexts (ADR-031)', () => {
  it('mounts the CLS actor context for every request through the HTTP middleware pipeline', async () => {
    // Arrange
    const app = await createProbeApp();

    // Act
    const response = await probe(app).get('/api/v1/test/articles/context/actor');

    // Assert — the store exists per request (distinct from "no context"),
    // proving ClsMiddleware mounted even though the actor seam is null.
    expect(response.status).toBe(200);
    expect(response.body.data.actorContextMounted).toBe(true);
    await app.close();
  });

  it('isolates the MikroORM EntityManager per concurrent request (RequestContext)', async () => {
    // Arrange
    const app = await createProbeApp();
    const http = probe(app);

    // Act — three concurrent requests against the same DI-injected EM.
    const [first, second, third] = await Promise.all([
      http.get('/api/v1/test/articles/context/em'),
      http.get('/api/v1/test/articles/context/em'),
      http.get('/api/v1/test/articles/context/em'),
    ]);

    // Assert — EntityManager#id respects the RequestContext, so each
    // concurrent request observed its own fork, not the shared global EM.
    const ids = [first.body.data.emId, second.body.data.emId, third.body.data.emId];
    expect(new Set(ids).size).toBe(3);
    await app.close();
  });
});

describe('Optimistic locking (ADR-029)', () => {
  it('progresses versions across successful updates and rejects stale expected versions with HTTP 409', async () => {
    // Arrange
    const app = await createProbeApp();
    const http = probe(app);
    const created = await http.post('/api/v1/test/articles').send({ title: 'lock' });
    const id = created.body.data.id;

    // Act
    const first = await http
      .put(`/api/v1/test/articles/${id}`)
      .send({ title: 'v2', expectedVersion: 1 });
    const second = await http
      .put(`/api/v1/test/articles/${id}`)
      .send({ title: 'v3', expectedVersion: 2 });
    const stale = await http
      .put(`/api/v1/test/articles/${id}`)
      .send({ title: 'stale', expectedVersion: 1 });
    const current = await http
      .put(`/api/v1/test/articles/${id}`)
      .send({ title: 'v4', expectedVersion: 3 });

    // Assert
    expect(first.status).toBe(200);
    expect(first.body.data.version).toBe(2);
    expect(second.status).toBe(200);
    expect(second.body.data.version).toBe(3);
    expect(stale.status).toBe(409);
    expect(stale.headers['content-type']).toContain('application/problem+json');
    expect(stale.body.code).toBe('VERSION_CONFLICT');
    expect(stale.body.status).toBe(409);
    expect(stale.body.title).toBe('Version Conflict');
    expect(current.status).toBe(200);
    expect(current.body.data.version).toBe(4);
    await app.close();
  });

  it('lets exactly one of two concurrent updates win and reports the loser as a conflict', async () => {
    // Arrange
    const app = await createProbeApp();
    const http = probe(app);
    const created = await http.post('/api/v1/test/articles').send({ title: 'race' });
    const id = created.body.data.id;

    // Act — both requests race with the same expected version.
    const [first, second] = await Promise.all([
      http.put(`/api/v1/test/articles/${id}`).send({ title: 'race-a', expectedVersion: 1 }),
      http.put(`/api/v1/test/articles/${id}`).send({ title: 'race-b', expectedVersion: 1 }),
    ]);

    // Assert
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
    const winner = first.status === 200 ? first : second;
    expect(winner.body.data.version).toBe(2);
    const read = await http.get(`/api/v1/test/articles/${id}`);
    expect(read.body.data.version).toBe(2);
    await app.close();
  });
});
