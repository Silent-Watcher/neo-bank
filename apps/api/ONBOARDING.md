# ONBOARDING.md — apps/api

Developer onboarding guide for the Neo Bank backend API. Written for someone
who has never seen this repository.

## 1. Introduction

This application is the backend of Neo Bank, a banking product in early
development. It is a REST API built with NestJS 12 running on Fastify
instead of Express. It currently serves health checks, a Problem Type
documentation page, and the first feature (enrollment challenge: it
validates a phone number, stores a six-digit OTP in Redis for 120 seconds
using atomic `SET NX EX`, and a verify endpoint consumes the stored code
atomically with attempt counting via a single Lua script; verification
failures are deliberately generic and indistinguishable; both endpoints
have rate limits aligned with the OTP window). Delivery via SMS and the
registration steps after verification are not implemented yet. A PostgreSQL
persistence layer (MikroORM v7, [ADR-027](../../DECISIONS.md)) is integrated
at infrastructure level — connection, health checks, and migrations — but it
holds no entities yet; Redis remains the only store feature code currently
uses.

Within the monorepo it is the `apps/api` workspace; the web and admin
frontends do not call it yet. Architectural context:
[../../docs/architecture.md](../../docs/architecture.md).

Current status: active development; infrastructure contracts are in place,
feature coverage is minimal.

## 2. Technology Stack

| Technology                               | Purpose                                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| NestJS 12                                | Application framework (modules, DI, pipes, filters, interceptors)                                       |
| Fastify (via `@nestjs/platform-fastify`) | HTTP platform — high-throughput target ([ADR-002](../../DECISIONS.md))                                  |
| SWC                                      | TypeScript transpilation (fast builds; type checking stays with `tsc`)                                  |
| Zod 4                                    | Validation for HTTP input and environment variables                                                     |
| @nestjs/config                           | Configuration namespaces via `registerAs` + `ConfigService`                                             |
| @nestjs/i18n                             | Bilingual en/fa translations: locale resolution, JSON catalogs ([ADR-021](../../DECISIONS.md))          |
| Pino / nestjs-pino                       | Structured logging; request-scoped context, header redaction                                            |
| @nestjs/terminus                         | `/health` (liveness) and `/health/ready` (readiness) endpoints                                          |
| ioredis 6                                | Redis client behind the shared `RedisService` ([ADR-012](../../DECISIONS.md)/[013](../../DECISIONS.md)) |
| MikroORM v7 (`@mikro-orm/*`)             | PostgreSQL persistence: ORM integration, migrations, health indicator ([ADR-027](../../DECISIONS.md))   |
| @nestjs/swagger + @fastify/static        | OpenAPI docs; Swagger UI at `/docs`, **development only** ([ADR-014](../../DECISIONS.md))               |
| Vitest + supertest                       | Unit and e2e testing                                                                                    |
| Testcontainers                           | Real Redis and PostgreSQL in integration & e2e tests (ADR-016/025); see `test/testcontainers.ts`        |
| Oxlint / Oxfmt                           | Linting and formatting (no ESLint/Prettier)                                                             |

Dependency notes: `@mikro-orm/postgresql` pulls `pg` (8.23.1) and,
transitively, `kysely` (0.29.8) — neither is a direct dependency.
`@mikro-orm/cli` and `@swc-node/register` are devDependencies used only by
the migration CLI, which loads its TypeScript configuration through SWC
(reusing the existing `@swc/core`).

## 3. Prerequisites

- Node.js **24.20.0** (allowed range `>=24.15 <25`; see `/.nvmrc`).
- pnpm **12.10.1** (enabled via `packageManager` in the root `package.json`;
  use `corepack enable` if pnpm is missing).
- A Redis server (≥ 4.0, required for `UNLINK`) is needed for Redis-backed
  features (enrollments OTP, global rate limiting), but the API starts without
  one: connection settings are validated at boot, and an unreachable server
  only degrades `/health`. Guarded routes fail closed (HTTP 500) when Redis
  is unreachable — no in-memory fallback.
- A PostgreSQL server is needed for persistence work (entities, migrations)
  and for the database integration tests, but the API starts without one:
  `DATABASE_URL` is validated at boot, and an unreachable server only
  degrades `/health` while `/health/ready` returns 503
  ([ADR-027](../../DECISIONS.md)).

## 4. Getting Started

All commands are run from this directory (`apps/api`) unless noted. To install
the whole workspace, run `pnpm install --frozen-lockfile` once at the repo
root.

**Configure environment variables** — env files are gitignored:

```sh
cp env/.env.example env/.env.development
# edit values if needed; defaults work for local development
```

| Variable                               | Meaning                                                                                                                                                                                                                                                                                                                            | Default behavior if unset                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `APP_ENV`                              | `development` \| `production` \| `test`                                                                                                                                                                                                                                                                                            | required                                          |
| `HOST`, `PORT`                         | Bind address and port                                                                                                                                                                                                                                                                                                              | required (dev/test files set `3001`)              |
| `CORS_ORIGIN`                          | Comma-separated allowed origins                                                                                                                                                                                                                                                                                                    | CORS disabled; required when `APP_ENV=production` |
| `TRUST_PROXY`                          | Trust proxy headers (`true`/`false`)                                                                                                                                                                                                                                                                                               | `false`                                           |
| `BODY_LIMIT`                           | Max request body bytes                                                                                                                                                                                                                                                                                                             | `1048576` (1 MiB)                                 |
| `DATABASE_URL`                         | PostgreSQL connection URL (`postgres://` or `postgresql://`, ADR-027); the connection is established during bootstrap with bounded retries and startup fails if the server cannot be reached (auth/config errors fail immediately) — after a successful boot, an outage degrades `/health` (HTTP 200), `/health/ready` returns 503 | required                                          |
| `REDIS_INSIGHT_URL`                    | Host-accessible Redis Insight URL; startup log prints it only when set (ADR-020)                                                                                                                                                                                                                                                   | unset (injected by the dev Compose stack)         |
| `MOCKSERVER_HOST_URL`                  | Host-machine MockServer address; the startup log prints it in development only when set (ADR-024)                                                                                                                                                                                                                                  | unset (injected by the dev Compose stack)         |
| `MOCKSERVER_DOCKER_URL`                | Compose-network MockServer address; the startup log prints it in development only when set (ADR-024)                                                                                                                                                                                                                               | unset (injected by the dev Compose stack)         |
| `LOG_LEVEL`                            | Pino level                                                                                                                                                                                                                                                                                                                         | `info`                                            |
| `LOG_PRETTY`                           | Explicit pretty-print override (`true`/`false`); the dev Compose stack sets `false` so containers emit JSON for centralized logging                                                                                                                                                                                                | unset → pretty only in development                |
| `REDIS_URL`                            | Redis URL (`redis://` or `rediss://`)                                                                                                                                                                                                                                                                                              | required                                          |
| `REDIS_USERNAME`, `REDIS_PASSWORD`     | Redis ACL credentials                                                                                                                                                                                                                                                                                                              | required; empty value = no authentication         |
| `REDIS_DB`                             | Logical database index (0–15)                                                                                                                                                                                                                                                                                                      | server default                                    |
| `REDIS_TLS`                            | Force TLS for `redis://` (`true`/`false`)                                                                                                                                                                                                                                                                                          | `false` (`rediss://` always uses TLS)             |
| `REDIS_CONNECT_TIMEOUT_MS`             | Connection timeout (ms)                                                                                                                                                                                                                                                                                                            | `10000`                                           |
| `REDIS_COMMAND_TIMEOUT_MS`             | Per-command timeout (ms)                                                                                                                                                                                                                                                                                                           | `5000`                                            |
| `REDIS_MAX_RETRIES_PER_REQUEST`        | Command retry budget                                                                                                                                                                                                                                                                                                               | `3`                                               |
| `REDIS_SHUTDOWN_TIMEOUT_MS`            | Graceful-QUIT window (ms)                                                                                                                                                                                                                                                                                                          | `2000`                                            |
| `RATE_LIMIT_SHORT_LIMIT`               | Short-window max requests                                                                                                                                                                                                                                                                                                          | `10`                                              |
| `RATE_LIMIT_SHORT_TTL_SECONDS`         | Short-window TTL in seconds                                                                                                                                                                                                                                                                                                        | `1`                                               |
| `RATE_LIMIT_LONG_LIMIT`                | Long-window max requests                                                                                                                                                                                                                                                                                                           | `100`                                             |
| `RATE_LIMIT_LONG_TTL_MINUTES`          | Long-window TTL in minutes                                                                                                                                                                                                                                                                                                         | `1`                                               |
| `ENROLLMENTS_MAX_VERIFY_ATTEMPTS`      | Max failed OTP verify attempts per window                                                                                                                                                                                                                                                                                          | `5`                                               |
| `ENROLLMENTS_LOCKOUT_TTL_SECONDS`      | Lockout window after max attempts (s)                                                                                                                                                                                                                                                                                              | `900` (15 min)                                    |
| `ENROLLMENTS_OTP_HMAC_SECRET`          | HMAC-SHA-256 key for OTP digest storage (ADR-018); required, no default — generate with `openssl rand -hex 32` (64 hex chars = 32 bytes), identical across API instances                                                                                                                                                           | —                                                 |
| `MEMORY_PROTECTION_ENABLED`            | Memory-based load shedding on/off, exactly `true`/`false` (ADR-026)                                                                                                                                                                                                                                                                | `true`                                            |
| `MEMORY_PROTECTION_MAX_RSS_MB`         | Process RSS (MB) that activates protection: non-exempt requests get 503 while active                                                                                                                                                                                                                                               | `1024`                                            |
| `MEMORY_PROTECTION_RECOVERY_RSS_MB`    | Recovery threshold (MB); must stay below the max threshold (validated at boot, hysteresis)                                                                                                                                                                                                                                         | `768`                                             |
| `MEMORY_PROTECTION_SAMPLE_INTERVAL_MS` | RSS sampling interval (ms); the 503 `Retry-After` is derived from it                                                                                                                                                                                                                                                               | `5000`                                            |
| `MEMORY_PROTECTION_STABLE_SAMPLES`     | Consecutive below-recovery samples required to deactivate protection                                                                                                                                                                                                                                                               | `3`                                               |

Startup fails fast with a readable Zod error if validation fails.

The test-tier env files (`env/.env.test`, `env/.env.redis-test`,
`env/.env.db-test`) are gitignored and contain validation-only
placeholders: `pnpm test:db` loads `.env.db-test`, whose `DATABASE_URL`
is never used to connect — each database spec connects to its own
Testcontainers container ([ADR-027](../../DECISIONS.md)).

**Run locally:**

```sh
pnpm dev          # watch mode on http://localhost:3001
```

Verify with `curl http://localhost:3001/health`.

**Run tests:**

```sh
pnpm test         # unit tests (Vitest) — mocks infrastructure, no Docker
pnpm test:e2e     # e2e tests (one shared Testcontainers Redis + PostgreSQL per run; needs Docker)
pnpm test:redis   # Redis integration tests (Testcontainers starts real Redis per test file)
pnpm test:db      # database integration tests (Testcontainers starts real PostgreSQL per test file)
```

**Build:**

```sh
pnpm build        # SWC compile to dist/
pnpm start        # node dist/main.js
```

## 5. Project Structure

```
src/
  main.ts                  # bootstrap: Fastify options, /api prefix, /v1 versioning, CORS
  i18n/                    # translation catalogs src/i18n/{en,fa}/*.json, key type
                           # registration (i18n.types.ts), catalog-consistency spec
  modules/
    app/                   # AppModule wiring, health check, Problem Type docs page
    enrollments/           # first feature module (OTP endpoint)
  shared/
    config/                # config.ts wiring, env/ Zod schemas, registerAs factories
    database/              # global DatabaseModule (ADR-027): MikroORM v7 PostgreSQL
                           # connection, health indicator, shared ORM options, CLI
                           # config, migrations/
    enums/                 # AppEnv enum
    errors/                # AppHttpException, ErrorCode, Problem Details helpers
    filters/               # global Problem Details error filter
    http/                  # request-ID generation/lifecycle, API version helpers
    i18n/                  # global I18nModule registration (locales, resolver,
                           # missing-key policy, catalog loader)
    interceptors/          # global success response envelope
    logging/               # nestjs-pino module and pino-http options
    memory-protection/     # ADR-026 load shedding: RSS sampler (hysteresis state
                           # machine), global MemoryProtectionGuard,
                           # @SkipMemoryProtection(), memory health indicator
    pipes/                 # ZodValidationPipe (translates Zod issues per request locale)
    redis/                 # global RedisModule: ioredis provider, RedisService,
                           # @InjectRedis(), degraded-mode health indicator
    swagger/               # dev-only OpenAPI setup + shared response schemas
test/                      # e2e specs + create-test-app.ts + e2e.global-setup.ts
                           # (shared e2e Redis and PostgreSQL) + Vitest alias map
env/                       # .env.development / .env.test / .env.redis-test /
                           # .env.db-test / .env.production / .env.example
```

**Where new features go:** create `src/modules/<feature>/` with a module,
controller, service, Zod schemas, and co-located `*.spec.ts` files, then
register the module in `src/modules/app/app.module.ts`. Cross-cutting code
that a second feature would need belongs in `src/shared/`.

**Routes:** every controller gets `/api/v1` automatically (global prefix +
URI versioning, [ADR-005](../../DECISIONS.md)/[ADR-007](../../DECISIONS.md)).
Only `/health`, `/health/ready`, and `/problems/application-error` sit
outside the prefix.

## 6. Development Workflow

**Adding an endpoint:**

1. Define a Zod schema for the request body/params/query in the feature's
   schema file. Schemas may normalize input (e.g. trim, fold country codes)
   before validating.
2. Add a controller method with
   `@Body(new ZodValidationPipe(schema))` (same pattern for `@Param`/`@Query`).
3. Implement the service method; return a plain object — the global
   interceptor wraps it as `{ timestamp, apiVersion, requestId, status,
   message, data }` automatically.
4. Throw `BadRequestException`/`AppHttpException` for errors; the global
   filter converts them to RFC 9457 Problem Details. Never hand-write
   response or error JSON.
5. Add unit tests (AAA style) and an e2e test using `test/create-test-app.ts`.

**Adding an environment variable:**

1. Add it to a Zod schema in `src/shared/config/env/schema/` (this is the
   only place `process.env` is read, by design — lint-enforced).
2. Map it through a `registerAs` factory in `src/shared/config/`.
3. Consume via `ConfigService` with the namespace symbol; add it to
   `env/.env.example` with a comment.

**Testing conventions:** Arrange–Act–Assert comments in unit tests; e2e specs
assert the envelope and Problem Details contracts. New top-level `#` import
aliases must also be added to `test/subpath-import-aliases.ts` or tests
will not resolve them.

**Real infrastructure in tests (ADR-016/025/027):** Tests that need Redis or
PostgreSQL use Testcontainers (`test/testcontainers.ts`, which provides
`TestRedis` and `TestPostgres`). The Redis integration tier
(`pnpm test:redis`) starts its own `redis:8.2-alpine` container per test
file with a dynamic port in `beforeAll` and stops it in `afterAll`; the
database integration tier (`pnpm test:db`, loads `env/.env.db-test`) starts
its own `postgres:17.6-alpine` container per test file the same way; the
e2e tier (`pnpm test:e2e`) shares one Redis and one PostgreSQL container
per test run, started by the Vitest globalSetup
(`test/e2e.global-setup.ts`) and injected into the specs through
`createE2eTestApp()`. No manual Docker Compose needed; unit tests
keep mocking infrastructure. Redis-tier specs override both `REDIS_CONFIG`
**and** `REDIS_CLIENT` in the testing module so the throttler and all
consumers share the container's connection; database-tier specs (and the
e2e setup) override `MIKRO_ORM_MODULE_OPTIONS` instead — overriding the
`DATABASE_CONFIG` `registerAs` token does not propagate through
`ConfigService`, the same caveat as the Redis config token.

**API documentation is mandatory:** every endpoint implemented or changed
must get its Swagger/OpenAPI documentation in the same task — see the
"API Documentation Rule" in [AGENTS.md](./AGENTS.md). In development, the
Swagger UI is at `http://localhost:3001/docs` and the raw document at
`/docs/json`; neither route exists in test or production.

**Relation to the rest of the monorepo:** none at runtime yet. Shared
tooling (lint, format, Turbo tasks) comes from the root; see
[../../AGENTS.md](../../AGENTS.md) for the feature/commit workflow.

## 7. Important Notes

- **Fastify, not Express:** use `FastifyRequest`/`FastifyReply` types and
  Fastify-compatible plugins; Express middleware does not work
  ([ADR-002](../../DECISIONS.md)).
- **ESM everywhere:** `"type": "module"` — relative imports in source need
  the `.js` extension; cross-directory imports use `#` aliases, never
  `../..`.
- **No `process.env`, no `console.log`:** both are lint errors. Configuration
  comes from `ConfigService`, logging from the injected Pino `Logger`.
- **Bootstrap is intentional:** adapter options, prefix, versioning, and CORS
  live in `main.ts` and must stay there.
- **Sensitive data:** the logger redacts authorization/cookie headers and
  never logs bodies; keep it that way.
- **Redis:** consume through the global `RedisModule`'s `RedisService`
  (inject it anywhere — no module import needed); `@InjectRedis()` is an
  escape hatch for native ioredis needs only. The server may be down at
  startup: `/health` then reports `degraded` with HTTP 200 and the client
  reconnects on its own. See `src/shared/redis/` and the API
  [AGENTS.md](./AGENTS.md) Redis rules.
- **Database:** MikroORM v7 on PostgreSQL
  ([ADR-027](../../DECISIONS.md), amended 2026-11-14); entities register per
  feature with `MikroOrmModule.forFeature`, and schema changes go only
  through migrations (`pnpm db:migration:*`) — never `schema:update` or
  `synchronize`. The initial connection is established during bootstrap with
  bounded retries; startup fails when the database cannot be reached
  (permanent authentication/configuration errors fail immediately). After a
  successful boot, a PostgreSQL outage degrades `/health` (HTTP 200) and
  `/health/ready` returns 503. See `src/shared/database/` and
  the API [AGENTS.md](./AGENTS.md) database rules.
- All ADRs ([../../DECISIONS.md](../../DECISIONS.md)) ADR-001 through
  ADR-027 are **Accepted** and implemented — follow them; don't
  reintroduce alternatives.

## 8. Useful Commands

```sh
pnpm dev                       # dev server with watch + env/.env.development
pnpm build                     # production build (SWC → dist/)
pnpm start                     # run the built app
pnpm test                      # unit tests (mocks infrastructure, no Docker)
pnpm test:e2e                  # e2e tests (one shared Testcontainers Redis + PostgreSQL per run; needs Docker)
pnpm test:redis                # Redis integration tests (Testcontainers starts real Redis per test file)
pnpm test:db                   # database integration tests (Testcontainers starts real PostgreSQL per test file)
pnpm db:migration:create       # MikroORM CLI: generate a migration from entity changes
pnpm db:migration:up           # apply pending migrations
pnpm db:migration:down         # revert the most recent migration
pnpm lint                      # Oxlint
pnpm format                    # Oxfmt (write)
pnpm format:check              # Oxfmt (check only)
pnpm typecheck                 # tsc --noEmit
pnpm clean                     # remove dist/
```

### Docker Compose Commands

Docker Compose is orchestrated from the repository root, not from this workspace — see the root `package.json` (`pnpm docker:dev` / `pnpm docker:dev:down` / `pnpm docker:prod` / `pnpm docker:prod:down`) and `docs/docker.md`.

**Prerequisites:**

- Copy `docker/env/.env.docker.example` to `docker/env/.env.docker.dev` (development) or `docker/env/.env.docker.prod` (production) and set `POSTGRES_PASSWORD` and `REDIS_PASSWORD`
- For production, create `apps/api/env/.env.production` from `apps/api/env/.env.example`

From the repo root, `pnpm test` runs unit + e2e for all workspaces through
Turborepo, and `pnpm cm` creates a Conventional Commit.
