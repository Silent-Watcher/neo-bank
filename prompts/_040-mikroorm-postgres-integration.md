# _040 — MikroORM v7 + PostgreSQL Integration

## Original Request

The user provided a structured task prompt: "Integrate MikroORM v7 with PostgreSQL into the NestJS API Application" — a Phase-1 inspection (report + plan, explicit stop for approval), then an approved implementation covering: PostgreSQL Docker verification (service already existed), `DATABASE_URL` environment configuration through the existing Zod validation layer, MikroORM v7 package installation, a database infrastructure module with `MikroOrmModule.forRootAsync()` (driver beside `useFactory`, `autoLoadEntities: true`, `ReflectMetadataProvider`), a shared runtime/CLI configuration, migration CLI scripts without creating any migration, a health-check extension, an ADR, a verbatim `CLAUDE.md` section, and full verification. Critical rules included: no entities or business logic, no schema synchronization, no commits, no changes outside `apps/api` (plus strictly necessary shared infrastructure), and no unverified claims.

## Implementation Record

### Phase 1 — Inspection and approval

- Session baseline produced by the `project-explorer` subagent; targeted reads of the API bootstrap, config layer, Redis module pattern, health controller, Docker Compose files, `DECISIONS.md` (ADR format), and testing harness.
- Verified MikroORM v7 specifics against the installed packages and the NestJS MikroORM documentation page (driver beside `useFactory` enabling the driver-specific EntityManager token; decorators in `@mikro-orm/decorators/legacy`; `registerRequestContext` middleware; Fastify-compatible `(.*)` route path; `onApplicationShutdown` close).
- Key empirical finding: `MikroORM.init()` in v7 never connects — non-blocking startup is the v7 default, matching the approved ADR-027 decision.
- Plan + ADR-027 presented; user approved both, choosing **non-blocking startup** (Redis-precedent semantics).

### ADR

- **ADR-027: Use MikroORM v7 with PostgreSQL for Persistence** — written into `DECISIONS.md` as the first repository write after explicit approval (Status: Accepted, 2026-11-14). Covers decision, alternatives (TypeORM, Prisma, Drizzle, raw `pg`), trade-offs, security assessment, operational implications.

### Dependencies (apps/api)

- Runtime: `@mikro-orm/core`, `@mikro-orm/postgresql`, `@mikro-orm/decorators`, `@mikro-orm/migrations` @ 7.2.9, `@mikro-orm/nestjs` @ 7.1.0.
- Dev: `@mikro-orm/cli` @ 7.2.9, `@swc-node/register` @ 1.12.1 (the MikroORM CLI's TS loader chain picks it up alongside the existing `@swc/core`; peers verified: `typescript >= 4.3 < 7` satisfies the 6.0.3 pin).
- Security assessment: `pnpm audit` — 7 pre-existing advisories, all in unrelated chains (commitizen, multer via nestjs-pino, glob/minimatch via testcontainers/@fastify/static); none from `@mikro-orm/*`; no install scripts in any new package; driver dependency tree confirmed (pg 8.23.1, kysely 0.29.8 — no knex).

### Files created

- `apps/api/src/shared/config/env/schema/db.env.ts` + spec — `DATABASE_URL` (required, `postgres://`/`postgresql://` protocol, trimmed).
- `apps/api/src/shared/config/database.config.ts` + spec — `DATABASE_CONFIG` symbol factory.
- `apps/api/src/shared/database/mikro-orm.options.ts` — shared runtime/CLI options builder (`ReflectMetadataProvider`, `discovery.warnWhenNoEntities: false`, migration paths, `Migrator` extension) + `CLI_ENTITY_PATHS` (feature-folder entity globs for the CLI).
- `apps/api/src/shared/database/database.module.ts` — `@Global()` module: `MikroOrmModule.forRootAsync` with `driver: PostgreSqlDriver` beside `useFactory`, URL from `ConfigService`, `autoLoadEntities: true`, exports `DatabaseHealthIndicator`.
- `apps/api/src/shared/database/database.health.ts` + spec — Terminus indicator (`postgres`): `check()` degraded / `checkReady()` down; connects first (v7 inits disconnected); probe bounded by a 5s race (`Promise.race`, no unhandled rejections); host:port-class error passthrough with localized fallback (`health.databaseUnavailable`, en + fa).
- `apps/api/src/shared/database/mikro-orm.config.ts` — standalone CLI config (`defineConfig` injects the driver; env URL via the `#config` alias, which resolves to compiled `dist/` inside the CLI process).
- `apps/api/src/shared/database/migrations/.gitkeep` — empty migrations folder; paths configured only.
- `apps/api/test/database.db-spec.ts` — DB integration tier: boots the real AppModule against a per-file Testcontainers Postgres (zero-entity boot, DI resolution, `/health` postgres up, degraded path on unreachable, connection closed on shutdown).
- `apps/api/test/vitest-db.config.ts`, `apps/api/env/.env.db-test` — the new `test:db` tier (mirrors the redis tier model).

### Files modified

- `env.config.ts` / `config.ts` — schema spread + factory load.
- `app.module.ts` — `DatabaseModule` import.
- `health.controller.ts` (+ spec) — postgres indicator on both endpoints; Swagger descriptions updated.
- `apps/api/test/testcontainers.ts` — `TestPostgres`/`startTestPostgres` helper (image `postgres:17.6-alpine`, waits for two "ready to accept connections" log occurrences).
- `apps/api/test/create-test-app.ts` — `createE2eTestApp` overrides `MIKRO_ORM_MODULE_OPTIONS` (driver + builder + `autoLoadEntities`) from the injected container URL; spec overrides keep precedence.
- `apps/api/test/e2e.global-setup.ts` — one shared Postgres container per e2e run alongside the shared Redis.
- `apps/api/package.json` — dependencies; scripts `db:migration:create/up/down` (`MIKRO_ORM_CLI_CONFIG` + `node --env-file` + real CLI entry) and `test:db`.
- Env files: `.env.example` (documented block), `.env.development` (populated from `docker/env/.env.docker.dev` credentials, service-hostname override documented), `.env.test` / `.env.redis-test` (validation-only placeholders), `.env.production` (intentionally empty — Compose injects it; fail-fast for non-Compose deployments).
- `docker/compose.app.dev.yml` + `compose.app.prod.yml` — api service `DATABASE_URL` override: `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}` (service hostname, container port).
- Root `CLAUDE.md` — "Database (PostgreSQL + MikroORM)" section appended verbatim per the task.
- `DECISIONS.md` — ADR-027 (see above).

### Independent decisions

- `@swc-node/register` as the CLI's TS loader (reuses the SWC toolchain; loader chain verified empirically).
- CLI config imports the env-validation layer through the `#config` package alias (verified to resolve inside the CLI process to compiled `dist/`), avoiding a lint-suppressed parent-relative import.
- Health probe timeout (5s) implemented at the indicator level via `Promise.race` because MikroORM v7 exposes no connect-timeout knob for the pg pool.
- DB test tier mirrors the redis tier (per-file container, `pnpm test:db`); the e2e tier gained one shared Postgres container in the existing global setup.
- Dev volume credential repair: the pre-existing `postgres_dev_data` volume (created 2026-11-10) held older credentials; aligned via `ALTER USER` inside the container to the current `docker/env/.env.docker.dev` value (non-destructive; no data reset).

### Validation results (all executed)

- `pnpm typecheck` — clean.
- Unit tests — 37 files, 334 tests, all passing.
- `pnpm test:db` — 4/4 passing.
- `pnpm test:redis` — 4 files, 60 tests, all passing.
- `pnpm test:e2e` — 15 files, 83 tests, all passing (suite now boots against a shared Testcontainers Postgres).
- `pnpm build` — SWC compile clean (69 files). `pnpm lint` — 0 errors (58 pre-existing warnings). `pnpm format:check` — clean.
- `docker compose up -d postgres` (dev stack env files) — container healthy; `pg_isready` passing.
- `mikro-orm debug` — TypeScript support enabled (swc), configuration found, driver deps pg/kysely, zero-entity discovery paths resolved, **database connection successful**.
- Real boot: `node --env-file=env/.env.development dist/main.js` → `/health` returns HTTP 200 with `postgres: up` (Redis degraded, as expected locally); SIGTERM shutdown exits cleanly; port released.
- `docker compose config` interpolation verified for dev and prod stacks (service-hostname URL, password redacted in output).

### Constraints honored

- No entities, repositories, migrations, seeders, or business logic created; no schema synchronization anywhere.
- No commits made; feature record `_040` included in the change set for the user-approved commit.
- Other applications untouched; no unrelated refactoring; no unrelated dependency upgrades.
