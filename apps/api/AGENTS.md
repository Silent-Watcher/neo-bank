# AGENTS.md — apps/api

Application-specific instructions for AI coding agents working on the NestJS
API. Repository-wide rules in the root [AGENTS.md](../../AGENTS.md) apply in
full; this file only adds API-specific conventions. Current implementation
status: [../../docs/current-state.md](../../docs/current-state.md).

## Purpose

The backend API for Neo Bank. Serves REST under `/api/v1` with a version-
neutral `/health` probe on the NestJS Node HTTP adapter, port 3001 in
development/test.

## Stack

- NestJS 12 on the official **Node HTTP platform** (`@nestjs/platform-node`,
  `NodeAdapter` — ADR-032, superseding ADR-002). Reusable components stay
  platform-agnostic (root rule: Platform-Agnostic Architecture); platform-
  specific code lives only in the bootstrap boundary.
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
  bootstrap connect, bounded coalescing health probe + health indicator,
  migrations — ADR-027/036), `redis/` (global
  RedisModule: ioredis client provider, `RedisService`,
  `@InjectRedis()`, health indicator through the coalesced
  `RedisHealthProbe` — ADR-037), `memory-protection/` (ADR-026
  memory-based load shedding: RSS sampler with a hysteresis state machine,
  global `MemoryProtectionGuard`, `@SkipMemoryProtection()`, memory
  readiness indicator), `swagger/` (dev-only OpenAPI setup +
  shared response schemas), `errors/` +
  `filters/problem-details.filter.ts` (RFC 9457 error contract),
  `interceptors/response-envelope.interceptor.ts` (success envelope),
  `pipes/zod-validation.pipe.ts`, `http/` (request IDs, API version,
  conditional-request/ETag support and the shared JSON content-type helpers,
  root not-found fallback),
  `throttler/` (global HTTP rate limiting: `@nestjs/throttler` + Redis
  storage, named policies, `RedisThrottlerGuard`, plus the
  `@DeferredRateLimit()` marker and `DeferredRateLimitGuard` — see
  "Deferred rate limits" below), `idempotency/` (global idempotency
  integration: official `@nestjs/idempotency` + Redis-backed
  `RedisIdempotencyStore`, ADR-039 — see "Idempotency" below),
  `i18n/` (global i18n
  registration: locale resolution, catalogs, missing-key policy — see
  "Internationalization" below).
- **Infrastructure provider tokens:** use `Symbol` tokens for infrastructure
  providers (e.g. `REDIS_CLIENT`), keep them defined inside the owning
  module's directory, and expose them to consumers only through the owning
  module's exports or a dedicated injection decorator.
- **Global guard order:** `MemoryProtectionGuard` is registered before
  `DeferredRateLimitGuard` — the registered global rate-limit guard, a
  `RedisThrottlerGuard` subclass (ADR-015, ADR-026) — so while memory
  protection is active, non-exempt requests are rejected with 503 on the
  cheapest possible path — no Redis round trip, no rate-limit bookkeeping —
  so the rejection path never depends on Redis. Opt out only for probes and
  documentation pages with `@SkipMemoryProtection()`.
- **Deferred rate limits (ADR-039):** a route whose quota must not be
  consumed by idempotent replays is marked `@DeferredRateLimit()`
  (`src/shared/throttler/deferred-rate-limit.decorator.ts`); the global
  guard skips it entirely, and a route-level `DeferredRateLimitInterceptor`
  (`src/shared/throttler/`, delegating to the official
  `ThrottlerGuard.canActivate` of the `RedisThrottlerGuard` exported by
  `ThrottlerEnforcementModule`) re-enforces the route's `@Throttle` metadata
  **after** the global `IdempotencyInterceptor` — so completed replays and
  in-flight `409 IDEMPOTENCY_KEY_IN_USE` duplicates never reach enforcement.
  Feature modules import `ThrottlerEnforcementModule`; throttler
  infrastructure never lives in a feature module. Never enforce a deferred
  route's quota with a guard or expect `@Throttle` alone to fire there; a
  deferred marker without a re-enforcing interceptor leaves the route
  unthrottled.
- **Idempotency (ADR-039):** every `@Idempotent()` handler must define
  `scope`, `fingerprint`, and `storeIf` deliberately per endpoint — never
  accept the defaults silently (pattern: `challengeIdempotentOptions` in
  `src/modules/enrollments/enrollments.idempotency.ts`; the scope secret is
  resolved lazily at request time because decorator arguments evaluate
  before a `ConfigService` exists). Idempotency record keys are built only
  through the co-located keys file
  (`src/shared/idempotency/idempotency.keys.ts` via `buildRedisKey`) and use
  a SHA-256 digest as the identifier — no raw identifiers (phone numbers,
  client keys) ever appear in a Redis key, a log, or an event payload. The
  store (`RedisIdempotencyStore`) runs four atomic Lua scripts on the shared
  client and owns no connection lifecycle; idempotency records are not
  evictable (`maxmemory-policy noeviction` is a deployment prerequisite).
- **Request/response contracts:** every successful JSON response is wrapped
  by the envelope interceptor; every error becomes Problem Details
  (ADR-010/011). Do not hand-roll response or error shapes; ADR-011 lists the
  response types that must bypass the envelope.
- **Conditional requests:** the global `ConditionalRequestInterceptor` sets a
  weak `ETag` over the serialized payload and the request's resolved locale
  (`weakEtagFor` in `src/shared/http/etag.ts`; ADR-032, ADR-038) plus
  `Cache-Control: private, no-cache` on every JSON-serializable response.
  Revalidation is **opt-in**: a route decorated with `@ConditionalGet()`
  (`src/shared/http/conditional-get.decorator.ts`) answers a matching
  `If-None-Match` (strict RFC 9110 parsing in
  `src/shared/http/if-none-match.ts`) with a bodyless `304` for GET on 2xx
  responses only — undecorated routes, HEAD (§7), other methods, error
  statuses, and redirects never revalidate. Routes bypassing the envelope
  (SSE, streams, non-JSON representations via the shared
  `json-content-type.ts` helpers) are not tagged either; Problem Details
  bodies (filter + root not-found fallback) carry locale-composed tags that
  never revalidate. The development Swagger documents the `If-None-Match`
  parameter and the `304` only for decorator-marked operations
  (`x-conditional-get`). Never set `ETag`, handle `If-None-Match`, or set
  cache directives in feature code.
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

### Swagger Endpoint Documentation Standard

Every controller endpoint must have a dedicated custom Swagger decorator function following the one-endpoint-one-decorator convention. Follow `agents/rules/swagger-endpoint-documentation.md` and read `agents/skills/swagger-endpoint-documentation/SKILL.md` before creating or modifying endpoint documentation.

Key conventions:

- One endpoint = one `Swagger`-prefixed function = one `applyDecorators` composition.
- Functions live in feature-local `<feature>.swagger.ts` (e.g., `enrollments.swagger.ts`).
- Functions use `applyDecorators` directly with all endpoint-specific Swagger decorators.
- Reuse existing schema constants (`toJsonSchemaObject` Zod schemas, `successEnvelopeSchema`, `problemDetailsSchema`).
- Runtime decorators (`@Post`, `@Throttle`, etc.) remain separate from Swagger decorators.
- Generated OpenAPI output must be verified via `test/swagger.e2e-spec.ts`.

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
  `common`, `enrollment`, `errors`, `health`, `otp`, `validation`. The English catalog is
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
    at response time. The pre-i18n request-ID rejection stays English
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
- Health checks stay bounded and coalesced (ADR-037): the Terminus
  indicators delegate to `RedisHealthProbe` (`redis.probe.ts` —
  single-flight over PING, 5 s success / 3 s failure cache, 3 s probe
  deadline); never reintroduce per-request PINGs, and keep the probe
  deadline below the client's `commandTimeout`. The client's black-hole
  recovery bound is `socketTimeout` (`REDIS_SOCKET_TIMEOUT_MS`, default 6000) — keep it above `commandTimeout` so per-command failures surface
  first.
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
- Every entity extends the shared abstract `BaseEntity`
  (`src/shared/database/base.entity.ts`, ADR-029): `id` (BIGINT/`bigserial`,
  TypeScript `string`), `createdAt`/`updatedAt` (`timestamptz(3)`),
  `createdBy`/`updatedBy` (nullable BIGINT scalars, no foreign keys),
  `version` (optimistic locking), `deletedAt` (soft-delete surface only).
  Child entities never redefine base properties and never manually assign
  ORM-managed fields (`createdAt`, `updatedAt`, `version`, audit
  attribution) — the `onCreate`/`onUpdate` callbacks and the Unit of Work
  own them. Declare BIGINT identifiers with an explicit
  `new BigIntType('string')` so values stay strings regardless of the
  compiler pipeline.
- Actor attribution resolves from the per-request CLS context
  (`src/shared/actor-context/`, ADR-029 as refined by ADR-031): the global
  `actorContextModule` mounts `nestjs-cls`'s `ClsMiddleware` for every route
  and `getActorId()` reads the store anywhere in the request chain — through
  DI (`@Inject(ClsService)`) or the non-DI bridge (ORM audit callbacks use
  the latter). `NULL` means the system performed the operation. Actor IDs
  never come from client input — when authentication lands, the module's
  extraction seam (`resolveActorId` in `actor-context.module.ts`) reads only
  the verified principal. Keep the store shape minimal; MikroORM's
  `RequestContext` (per-request EntityManager fork) is a separate mechanism
  and stays untouched.
- Optimistic locking is MikroORM-owned (`@Property({ version: true })`).
  Update workflows accept the client's expected version as a DTO field and
  call `await em.lock(entity, LockMode.OPTIMISTIC, { lockVersion })` inside
  the try block that also wraps `flush()` (both can raise the lock error),
  mapping failures through `mapOptimisticLockError` from
  `src/shared/errors/optimistic-lock.mapper.ts` → `ErrorCode.VersionConflict`
  (HTTP 409). Never assign the client's version to the entity and never
  increment versions manually.
- Timestamps follow the UTC-first policy (ADR-030, `docs/utc-datetime.md`):
  `timestamptz` columns (precision 3 where `Date` is canonical), UTC-pinned
  PostgreSQL containers, and user-timezone conversion only at the
  presentation boundary via IANA identifiers — calendar-day/range queries
  use `calendarDayUtcRange` from `src/shared/datetime/utc-datetime.ts`.
- Schema changes go exclusively through explicit SQL migrations: generate
  with `pnpm db:migration:create`, apply with `pnpm db:migration:up`,
  revert with `pnpm db:migration:down`. Never run `mikro-orm schema:update`
  and never configure `synchronize` anywhere.
- Existing migrations are immutable (ADR-033, root "Database Entity and
  Migration Governance"): never edit, delete, rename, squash, or rewrite one;
  every schema change and every correction is a new forward migration with
  `up()`/`down()`. Every generated migration is inspected before execution
  and must pass the `migration-reviewer` subagent's structured review before
  the task completes.
- Schema design follows the root "Strict Database Constraint Discipline"
  (Database Entity and Migration Governance): every field gets an
  intentional database contract (type, nullability, length/precision,
  defaults, check/unique constraints, indexes); application validation never
  replaces database constraints. Unclear field semantics stop schema work
  until the developer approves the contract. Business invariants that bound
  row existence (the one-non-expired-Enrollment-per-phone rule, root
  "Neo Bank Business Domain") are enforced by database constraints such as
  partial unique indexes, not by application-level lookups.
- Outside an HTTP request context there is no request-scoped
  `EntityManager`: use `em.fork()` or the `@CreateRequestContext()`
  decorator (from `@mikro-orm/decorators/legacy`) for background work. Such
  work runs without an actor context and is attributed to the system
  (`createdBy`/`updatedBy` stay `NULL`).
- Never inject another feature's repositories or EntityManagers; reach
  another feature's data only through that feature's public service API.
- PostgreSQL is architecture-required: the initial connection is established
  during bootstrap with bounded retries and startup fails when the database
  cannot be reached (ADR-027 amendment). After a successful boot, an
  unreachable PostgreSQL degrades `/health` (HTTP 200) and fails
  `/health/ready` with HTTP 503. The integration closes the connection
  on application shutdown (`enableShutdownHooks()` in `main.ts`).
- Health probes stay bounded and coalesced (ADR-036): `DatabaseHealthProbe`
  borrows one pool client under a 3 s deadline with a 2 s server-enforced
  `statement_timeout`, releases the client exactly once (an errored release
  evicts it locally), and single-flights concurrent probes behind a short TTL
  cache — never reintroduce unbounded per-request probes
  (`orm.checkConnection()`). Pool sizing and deadlines are explicit in
  `mikro-orm.options.ts` (`DATABASE_POOL_MAX`, default 10); the CLI migration
  configuration keeps `statement_timeout` off.
- Database integration tests use Testcontainers (`pnpm test:db`,
  image `postgres:18.7-alpine`): each
  `*.db-spec.ts` file boots the real AppModule against its own container
  and overrides `MIKRO_ORM_MODULE_OPTIONS` (overriding the
  `DATABASE_CONFIG` `registerAs` token does not propagate through
  `ConfigService` — the same caveat as the Redis config token). Overrides
  must set `autoLoadEntities: false` and list entities explicitly: with
  `autoLoadEntities` on, `@mikro-orm/nestjs` copies `forFeature`
  registrations into `entitiesTs`, and TS-mode discovery (Vitest) uses
  `entitiesTs` INSTEAD of `entities` — an explicit `entities` list would be
  silently ignored. The list must contain `BaseEntity`, every entity
  registered with `forFeature` anywhere in the booted module tree (their
  repository providers resolve eagerly against the explicit list), and any
  test-only fixture entities (the MikroORM rule for explicit entity lists)
  — never registered in production discovery.

## Directory Structure

```
src/
  main.ts                  # bootstrap only (HTTP adapter, prefix, versioning, CORS)
  modules/
    app/                   # AppModule, health check, Problem Type docs page
    enrollments/           # feature modules: controller + service + schema + specs
  shared/
    config/                # config.ts wiring + env/ Zod schemas + factories
    database/              # global DatabaseModule (ADR-027): MikroOrmModule.forRootAsync,
                           # health probe + indicator (ADR-036), shared ORM options +
                           # CLI config, migrations/
    memory-protection/     # ADR-026 load shedding: RSS sampler (hysteresis),
                           # MemoryProtectionGuard, @SkipMemoryProtection,
                           # memory health indicator
    redis/                 # global RedisModule: provider, RedisService, InjectRedis,
                           # key builder (redis-keys.ts), health probe (ADR-037)
    idempotency/           # global idempotency integration (ADR-039): official
                           # IdempotencyModule + RedisIdempotencyStore (atomic
                           # Lua scripts), co-located keys file
    swagger/               # OpenAPI setup (dev-only), shared response schemas
    throttler/             # global rate limiting: RedisThrottlerStorage, Guard,
                           # module, keys, @DeferredRateLimit + DeferredRateLimitGuard
    enums/ errors/ filters/ http/ interceptors/ logging/ pipes/
test/
  create-test-app.ts       # e2e app factory mirroring main.ts bootstrap
                           # (createE2eTestApp wires the shared e2e Redis
                           # and PostgreSQL)
  e2e.global-setup.ts      # Vitest globalSetup: one shared Testcontainers
                           # Redis + one shared PostgreSQL per e2e run
                           # (ADR-025/027, provide/inject)
  testcontainers.ts        # Testcontainers helpers: TestRedis, TestPostgres,
                           # TestToxiproxy (start/stop/getConfig)
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
pnpm test:coverage # unit tests + Vitest coverage (text/HTML/LCOV in coverage/)
pnpm test:e2e     # supertest e2e suite (one shared Testcontainers Redis + PostgreSQL per run)
pnpm test:redis   # real-Redis integration suite via Testcontainers
pnpm test:db      # real-PostgreSQL integration suite via Testcontainers (per test file)
pnpm db:migration:create # MikroORM CLI: generate a migration from entity changes
pnpm db:migration:up     # apply pending migrations
pnpm db:migration:down   # revert the most recent migration
```

## Constraints

- Follow the decision records in [../../DECISIONS.md](../../DECISIONS.md) —
  all ADRs ADR-001 through ADR-039 are **Accepted** and implemented; do not
  build against
  their rejected alternatives.
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
