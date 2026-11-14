# AGENTS.md — apps/api

Application-specific instructions for AI coding agents working on the NestJS
API. Repository-wide rules in the root [AGENTS.md](../../AGENTS.md) apply in
full; this file only adds API-specific conventions. Current implementation
status: [../../docs/current-state.md](../../docs/current-state.md).

## Purpose

The backend API for Neo Bank. Serves REST under `/api/v1` with a version-
neutral `/health` probe on Fastify, port 3001 in development/test.

## Stack

- NestJS 12 on **Fastify** (ADR-002) — never add Express-specific code; use
  Fastify types (`FastifyRequest`/`FastifyReply`) and plugins.
- ESM (`"type": "module"`) with Node.js native `#` subpath import aliases
  (root rule; alias map in `package.json` → `imports`).
- SWC transpiles (`.swcrc`, ADR-003); type safety is enforced separately by
  `pnpm typecheck` (`tsc --noEmit`).
- MikroORM v7 on PostgreSQL for persistence (ADR-027) — global integration
  in `src/shared/database/`; see "Database Rules" below.
- Zod 4 for input and environment validation; Vitest for unit and e2e tests;
  Oxlint with `no-console`, `no-process-env`, and
  `import/no-relative-parent-imports` as errors.

## Architecture

- **Bootstrap:** all HTTP bootstrap config (adapter options, `api` prefix,
  URI versioning, CORS) lives in `bootstrap()` in `src/main.ts`. Do not
  extract it.
- **Feature modules:** `src/modules/<feature>/` — controller, service,
  Zod schemas, and co-located specs per feature. Registered in
  `src/modules/app/app.module.ts`.
- **Shared infrastructure:** `src/shared/` — `config/` (Zod env schemas +
  `registerAs` factories), `logging/` (nestjs-pino), `database/` (global
  DatabaseModule: MikroORM v7 PostgreSQL connection with bounded-retry
  bootstrap connect, health indicator, migrations — ADR-027), `redis/` (global
  RedisModule: ioredis client provider, `RedisService`,
  `@InjectRedis()`, health indicator), `memory-protection/` (ADR-026
  memory-based load shedding: RSS sampler with a hysteresis state machine,
  global `MemoryProtectionGuard`, `@SkipMemoryProtection()`, memory
  readiness indicator), `swagger/` (dev-only OpenAPI setup +
  shared response schemas), `errors/` +
  `filters/problem-details.filter.ts` (RFC 9457 error contract),
  `interceptors/response-envelope.interceptor.ts` (success envelope),
  `pipes/zod-validation.pipe.ts`, `http/` (request IDs, API version),
  `throttler/` (global HTTP rate limiting: `@nestjs/throttler` + Redis
  storage, named policies, `RedisThrottlerGuard`), `i18n/` (global i18n
  registration: locale resolution, catalogs, missing-key policy — see
  "Internationalization" below).
- **Infrastructure provider tokens:** use `Symbol` tokens for infrastructure
  providers (e.g. `REDIS_CLIENT`), keep them defined inside the owning
  module's directory, and expose them to consumers only through the owning
  module's exports or a dedicated injection decorator.
- **Global guard order:** `MemoryProtectionGuard` is registered before
  `RedisThrottlerGuard` (ADR-026): while memory protection is active,
  non-exempt requests are rejected with 503 on the cheapest possible path —
  no Redis round trip, no rate-limit bookkeeping — so the rejection path
  never depends on Redis. Opt out only for probes and documentation pages
  with `@SkipMemoryProtection()`.
- **Request/response contracts:** every successful JSON response is wrapped
  by the envelope interceptor; every error becomes Problem Details
  (ADR-010/011). Do not hand-roll response or error shapes; ADR-011 lists the
  response types that must bypass the envelope.
- **Redis:** global `RedisModule` in `src/shared/redis/` (ADR-012/013) owns
  the single ioredis client and its lifecycle; `RedisService` is the
  application interface. Redis connection settings are mandatory, but the
  server being unreachable degrades health (HTTP 200), never blocks startup
  or crashes the process.
- **Database:** global `DatabaseModule` in `src/shared/database/` (ADR-027)
  owns the single MikroORM v7 PostgreSQL instance and its lifecycle;
  entity, migration, and health conventions are in "Database Rules" below.
- **Swagger/OpenAPI:** `@nestjs/swagger`, set up by `setupSwagger` in
  `src/shared/swagger/swagger.setup.ts` and gated to `APP_ENV=development`
  in `main.ts` (ADR-014). The UI is at `/docs`, the document at
  `/docs/json`. Request schemas come from Zod via `toJsonSchemaObject`;
  shared response schemas (envelope, Problem Details) live in
  `src/shared/swagger/openapi.schemas.ts`.

## Internationalization

The API is bilingual: `en` (default) and `fa`, via the official
`@nestjs/i18n` (ADR-021). The repository-wide bilingual development rule lives
in the root `AGENTS.md`; this section covers the API-specific mechanics.

- **Registration:** `src/shared/i18n/i18n.module.ts` (`I18nModule.forRootAsync`)
  owns `defaultLocale: 'en'`, `supportedLocales: ['en', 'fa']`, the
  `AcceptLanguageLocaleResolver` (the only active resolver — the in-file
  comment block documents how to add more), the missing-key policy
  (`throw` in development/test, `fallback` in production), and catalog
  loading/watching.
- **Catalogs:** `src/i18n/{en,fa}/<namespace>.json`. Namespaces so far:
  `common`, `errors`, `health`, `otp`, `validation`. The English catalog is
  the key source of truth; `src/i18n/i18n.types.ts` registers its shape with
  `I18nTypes`, making translation keys compile-time checked. Persian messages
  use formal, natural Persian with correct نیم‌فاصله; genuinely ambiguous
  wording goes to the user before being chosen.
- **Producing localized messages:**
  - Services/exceptions: inject `I18nService` and throw
    `AppHttpException(code, i18n.t('<key>', { args }), status)` — `code` and
    status never localize.
  - Zod schemas: attach catalog keys with `i18nIssueMessage('<key>')`;
    unkeyed issues fall back to `validation.<zod issue code>` catalog keys.
    `ZodValidationPipe` translates issues for the request's locale before
    formatting.
  - Error titles: `titleKeyForErrorCode`/`titleKeyForStatus` map to
    `errors.*` catalog keys; the Problem Details filter translates the title
    at response time. The pre-i18n Fastify request-ID rejection stays English
    by design.
  - Envelope: only `message` is localized (`common.success`); response data
    is never translated.
- **Non-negotiables:** never translate JSON property names, Zod paths, error
  codes, identifiers, logs, or machine-readable values; OTP values, IDs, and
  technical codes stay English digits. `Content-Language`/`Vary` headers are
  set by the i18n middleware (`responseHeaders: true`) and must not be
  overwritten.
- **Catalog delivery:** `nest-cli.json` copies `i18n/**/*.json` into `dist`
  (assets + `watchAssets`); production reads them from `dist/i18n`. Adding a
  locale means a new catalog directory plus a `supportedLocales` entry —
  never a wider glob.
- **Tests:** `src/i18n/i18n.catalog.spec.ts` enforces key/placeholder/plural
  parity between locales; `test/i18n.e2e-spec.ts` covers resolution,
  headers, localization, isolation, and health regression. Extend both when
  touching messages.

## Mandatory API Documentation Rule

Every time a new API endpoint is implemented, or an existing endpoint's
request/response contract changes, its Swagger/OpenAPI documentation MUST be
implemented or updated in the same task. An endpoint whose documentation is
missing or outdated is an incomplete implementation — passing tests alone do
not make it done.

For every endpoint, the implementing agent/developer must:

1. Add appropriate Swagger decorators to the controller and endpoint.
2. Document purpose and expected behavior with `@ApiOperation()`.
3. Group endpoints with `@ApiTags()`.
4. Document all relevant path parameters, query parameters, headers, and
   request bodies.
5. Document required and optional request fields accurately.
6. Document successful response schemas and HTTP status codes.
7. Document relevant error responses based on the application's actual error
   contract (`problemDetailsSchema`).
8. Keep OpenAPI request schemas consistent with the corresponding Zod
   validation schemas (derive them with `toJsonSchemaObject`; do not restate
   validation rules by hand).
9. Verify the generated document contains the correct endpoint, request
   schema, and response definitions (e2e assertions in `test/swagger.e2e-spec.ts`
   show the pattern).

Constraints:

- Do not add fake endpoints or test-only controllers for documentation
  purposes.
- Do not introduce authentication decorators (`@ApiBearerAuth`, security
  schemes) unless a dedicated task adds authentication documentation.
- Keep the development-only registration intact; never expose Swagger in
  test or production.

## Redis Rules

- Application business logic uses `RedisService` for ordinary Redis
  operations; direct ioredis injection via `@InjectRedis()` is an exceptional
  escape hatch that requires a justified use case.
- Do not import ioredis in feature modules merely to run basic commands, and
  never reference the internal `REDIS_CLIENT` token outside
  `src/shared/redis/`.
- Do not expand `RedisService` into a one-to-one wrapper of the ioredis API;
  add methods only for concrete application needs.
- Do not bake serialization, key prefixing, or caching policies into the
  shared Redis module without an explicit architectural requirement.
- Redis keys follow the root AGENTS.md key-naming convention
  (`<app>:<module>:<feature>:<resource>:<identifier>`, e.g.
  `neo-bank:enrollments:challenge:otp:<phone>`): build them with
  `buildRedisKey` from `src/shared/redis/redis-keys.ts` via a single
  co-located keys file per feature module (see
  `src/modules/enrollments/enrollments.keys.ts`); never concatenate raw
  strings at call sites.
- Multi-step Redis flows that must execute together (read-check-delete,
  read-check-write) go through an atomic Lua script on the shared client
  (see `RedisService.deleteIfEquals`), never as separate commands issued
  from feature code; the root AGENTS.md error-response-security rules apply
  to anything built on Redis state (e.g. OTP verification failures must be
  generic and indistinguishable).
- Never use `KEYS`; iterate with `SCAN` (`RedisService.scanKeys`, bounded).
  Delete with `UNLINK`, never `DEL` (requires Redis server ≥ 4.0 — a
  deployment requirement, not a runtime fallback).
- Use atomic Redis operations (e.g. `INCRBY`) when the use case needs them;
  do not add transactions, Lua scripts, or locks without a concrete
  requirement, and never treat pipelining as atomicity.
- Unit tests must not require a running Redis server: use `lazyConnect`
  client instances and provider overrides. Real-Redis tests use
  Testcontainers (`test/testcontainers.ts`, ADR-016) in two tiers: the Redis
  integration suite (`*.redis-spec.ts`) starts its own `redis:8.2-alpine`
  container per test file and overrides both `REDIS_CONFIG` **and**
  `REDIS_CLIENT` in the testing module; the e2e suite shares one container
  per test run via the Vitest globalSetup (`test/e2e.global-setup.ts`,
  ADR-025) and builds its apps with `createE2eTestApp()`, which injects the
  container's connection config and overrides `REDIS_CLIENT` (overriding
  `REDIS_CONFIG` alone does not work — `ConfigService` holds the `registerAs`
  result and does not observe provider overrides on that token). Tests that
  exercise the fail-closed path inject an unroutable client directly.

## Database Rules

- Persistence is MikroORM v7 on PostgreSQL (ADR-027): the global
  `DatabaseModule` in `src/shared/database/` owns the single ORM instance
  and its lifecycle. Feature modules never configure connections, drivers,
  or entity discovery paths themselves.
- Register feature entities with `MikroOrmModule.forFeature([Entity])`
  inside the feature module — the global module runs with
  `autoLoadEntities`, so no central entity list exists. Entities live in
  the feature's own `entities/` folder, one entity per file,
  `<name>.entity.ts` (the MikroORM CLI discovers them through the globs in
  `mikro-orm.options.ts`).
- Schema changes go exclusively through explicit SQL migrations: generate
  with `pnpm db:migration:create`, apply with `pnpm db:migration:up`,
  revert with `pnpm db:migration:down`. Never run `mikro-orm schema:update`
  and never configure `synchronize` anywhere.
- Outside an HTTP request context there is no request-scoped
  `EntityManager`: use `em.fork()` or the `@CreateRequestContext()`
  decorator (from `@mikro-orm/decorators/legacy`) for background work.
- Never inject another feature's repositories or EntityManagers; reach
  another feature's data only through that feature's public service API.
- PostgreSQL is optional at runtime, like Redis: MikroORM v7 initializes
  without connecting, so an unreachable server never blocks startup —
  `/health` reports `degraded` (HTTP 200) and `/health/ready` fails with
  HTTP 503 (same contract as Redis). The integration closes the connection
  on application shutdown (`enableShutdownHooks()` in `main.ts`).
- Database integration tests use Testcontainers (`pnpm test:db`,
  `test/database.db-spec.ts`, image `postgres:17.6-alpine`): each
  `*.db-spec.ts` file boots the real AppModule against its own container
  and overrides `MIKRO_ORM_MODULE_OPTIONS` (overriding the
  `DATABASE_CONFIG` `registerAs` token does not propagate through
  `ConfigService` — the same caveat as the Redis config token).

## Directory Structure

```
src/
  main.ts                  # bootstrap only (Fastify, prefix, versioning, CORS)
  modules/
    app/                   # AppModule, health check, Problem Type docs page
    enrollments/           # feature modules: controller + service + schema + specs
  shared/
    config/                # config.ts wiring + env/ Zod schemas + factories
    database/              # global DatabaseModule (ADR-027): MikroOrmModule.forRootAsync,
                           # health indicator, shared ORM options + CLI config, migrations/
    memory-protection/     # ADR-026 load shedding: RSS sampler (hysteresis),
                           # MemoryProtectionGuard, @SkipMemoryProtection,
                           # memory health indicator
    redis/                 # global RedisModule: provider, RedisService, InjectRedis,
                           # key builder (redis-keys.ts)
    swagger/               # OpenAPI setup (dev-only), shared response schemas
    throttler/             # global rate limiting: RedisThrottlerStorage, Guard,
                           # module, keys
    enums/ errors/ filters/ http/ interceptors/ logging/ pipes/
test/
  create-test-app.ts       # e2e app factory mirroring main.ts bootstrap
                           # (createE2eTestApp wires the shared e2e Redis
                           # and PostgreSQL)
  e2e.global-setup.ts      # Vitest globalSetup: one shared Testcontainers
                           # Redis + one shared PostgreSQL per e2e run
                           # (ADR-025/027, provide/inject)
  testcontainers.ts        # Testcontainers helpers: TestRedis, TestPostgres
                           # (start/stop/getConfig)
  *.e2e-spec.ts            # supertest-based e2e suites
  *.redis-spec.ts          # real-Redis integration tests via Testcontainers (pnpm test:redis)
  *.db-spec.ts             # real-PostgreSQL integration tests via Testcontainers (pnpm test:db)
  subpath-import-aliases.ts # Vitest resolution of # aliases (keep in sync)
env/                       # .env.development / .env.test / .env.example /
                           # .env.redis-test / .env.db-test / .env.production
                           # (gitignored except example)
```

## Naming Conventions

- Feature modules singular-or-plural as the domain requires; files
  `<name>.module.ts`, `<name>.controller.ts`, `<name>.service.ts`,
  `<name>.schema.ts`, specs `<name>.spec.ts`, e2e `test/<name>.e2e-spec.ts`.
- Zod schemas exported as camelCase `xSchema` (e.g. `requestOtpSchema`);
  config symbols as `SCREAMING_SNAKE` (e.g. `SERVER_CONFIG`).
- Tests follow Arrange–Act–Assert with those comments marking the sections.

## Coding, Validation, and Error Conventions

- New env variable → add to a Zod schema in
  `src/shared/config/env/schema/` + a `registerAs` factory; never read
  `process.env` elsewhere (lint-enforced; the only exception is
  `env.config.ts`).
- Validate external input with `ZodValidationPipe` and a dedicated Zod
  schema per use case; schemas may normalize (transform) before validating.
- Errors: throw `BadRequestException` (message array) for validation
  failures and `AppHttpException` with an `ErrorCode` for domain errors; the
  global filter turns them into Problem Details. Never catch errors into
  ad-hoc response shapes. Localize the `detail` at the throw site (en/fa);
  the filter localizes the `title`.
- The Problem Details filter logs exceptions with an attached error at error
  level; deliberate bare HTTP exceptions (e.g. load-shedding 503s) log at
  warn as `HTTP <status> <code>` — throw a bare exception only for expected,
  deliberate rejections.
- Logging only through the injected Pino `Logger` / `PinoLogger`;
  `console.log` is lint-banned.
- New `#` alias → add it in `package.json` `imports` **and**
  `test/subpath-import-aliases.ts`, or Vitest breaks.

## Testing Expectations

- Unit tests (AAA) for schemas, services, controllers; e2e tests via
  `test/create-test-app.ts` for endpoint contracts (envelope, Problem
  Details, routing). Both layers are a project requirement for features
  (root rule).
- Unit tests mock infrastructure (RedisService, DatabaseHealthIndicator);
  real-infrastructure tests use Testcontainers (ADR-016) —
  `test/testcontainers.ts` provides the `TestRedis` and `TestPostgres`
  classes. The Redis and database integration tiers run per test file
  (`*.redis-spec.ts` via `pnpm test:redis`, `*.db-spec.ts` via
  `pnpm test:db`); the e2e tier shares one Redis and one PostgreSQL
  container per run (Vitest globalSetup `test/e2e.global-setup.ts`,
  ADR-025/027) via `createE2eTestApp()`. Tests exercising fail-closed
  behavior inject an unroutable client.
- Do not start dev servers to verify intermediate steps; run the checks when
  the feature is complete (root rule).

## Commands

```sh
pnpm dev          # watch mode (node --env-file + nest start --watch)
pnpm build        # nest build (SWC)
pnpm lint         # oxlint
pnpm format       # oxfmt --write .
pnpm typecheck    # tsc --noEmit
pnpm test         # Vitest unit tests (mocks, no Docker)
pnpm test:e2e     # supertest e2e suite (one shared Testcontainers Redis + PostgreSQL per run)
pnpm test:redis   # real-Redis integration suite via Testcontainers
pnpm test:db      # real-PostgreSQL integration suite via Testcontainers (per test file)
pnpm db:migration:create # MikroORM CLI: generate a migration from entity changes
pnpm db:migration:up     # apply pending migrations
pnpm db:migration:down   # revert the most recent migration
```

## Constraints

- Follow the decision records in [../../DECISIONS.md](../../DECISIONS.md) —
  all ADRs ADR-001 through ADR-027 are **Accepted** and implemented; do not
  build against their rejected alternatives.
- New architectural decisions follow the ADR-first workflow in the root
  [AGENTS.md](../../AGENTS.md): propose the ADR, get explicit user approval,
  write the accepted ADR as the first repository change, then implement.
- Inspect existing shared infrastructure before adding any abstraction,
  dependency, or pattern — the `shared/` layer already covers config,
  logging, errors, envelopes, validation, and rate limiting.
- When a change matches a Documentation Update Triggers entry in the root
  [AGENTS.md](../../AGENTS.md), update the listed documentation in the same
  task (for the API that is usually this file, `ONBOARDING.md`, and
  `docs/current-state.md`).
- NestJS configuration work has a dedicated skill/convention:
  `agents/skills/nest-config/` (root rule).
