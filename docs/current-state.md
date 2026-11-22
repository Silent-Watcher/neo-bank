# Current Development State

Snapshot of what exists in the repository. Last verified: 2026-11-22.
Legend: **Implemented** / **Partial** / **Planned** / **Unknown**.

## Maturity

Early-stage pre-product. The backend has real infrastructure (config, logging,
error contracts, request IDs, a Redis integration module, a PostgreSQL
persistence layer) and one small feature; both frontends are untouched
framework scaffolds. No auth, no deployment setup; the persistence layer has
its shared entity base plus the first feature entity (`Enrollment`, table
`enrollments`).

## Applications

### `apps/api` — NestJS backend on the Node HTTP platform (active)

**Implemented**

- Bootstrap in `src/main.ts`: `NodeAdapter` (`@nestjs/platform-node`,
  ADR-032) with `trustProxy`, explicit `json`/`urlencoded` body parsers
  limited by `BODY_LIMIT`, an adapter-level request-ID lifecycle (ID
  assignment, echo, early 400 rejection), an explicit 20 s keep-alive
  timeout, a root-level not-found fallback keeping Problem Details outside
  the global prefix, global `api` prefix, URI versioning (`/api/v1`), and
  CORS from validated config. After a successful listen, the API logs its
  address (`http://<address>:<port>/api/v1`, loopback plus non-internal
  interface addresses for the wildcard host) and, in development only, the
  Swagger UI address plus — when the development Compose stack injects them —
  the MockServer addresses (ADR-024); always plain `http`, since no TLS or
  reverse proxy fronts the API.
- Configuration system: Zod-validated env (ADR-004), env files in
  `env/` (`.env.development`, `.env.test`, `.env.example`, `.env.redis-test`,
  `.env.db-test`, `.env.production`),
  namespaced `registerAs` factories, fail-fast validation. Validated variables:
  `APP_ENV`, `HOST`, `PORT`, `CORS_ORIGIN`, `TRUST_PROXY`, `TRUST_PROXY_PROXIES`,
  `BODY_LIMIT`,
  `DATABASE_URL`, `DATABASE_POOL_MAX`, `LOG_LEVEL`, `REDIS_URL`,
  `REDIS_USERNAME`, `REDIS_PASSWORD`,
  `REDIS_DB`,
  `REDIS_TLS`, `REDIS_CONNECT_TIMEOUT_MS`, `REDIS_COMMAND_TIMEOUT_MS`,
  `REDIS_SOCKET_TIMEOUT_MS`, `REDIS_MAX_RETRIES_PER_REQUEST`,
  `REDIS_SHUTDOWN_TIMEOUT_MS`,
  `RATE_LIMIT_SHORT_LIMIT`, `RATE_LIMIT_SHORT_TTL_SECONDS`,
  `RATE_LIMIT_LONG_LIMIT`, `RATE_LIMIT_LONG_TTL_MINUTES`,
  `ENROLLMENTS_MAX_VERIFY_ATTEMPTS`, `IDEMPOTENCY_SCOPE_SECRET`,
  `REDIS_INSIGHT_URL`,
  `MOCKSERVER_HOST_URL`, `MOCKSERVER_DOCKER_URL`, `LOG_PRETTY`,
  `MEMORY_PROTECTION_ENABLED`, `MEMORY_PROTECTION_MAX_RSS_MB`,
  `MEMORY_PROTECTION_RECOVERY_RSS_MB`, `MEMORY_PROTECTION_SAMPLE_INTERVAL_MS`,
  `MEMORY_PROTECTION_STABLE_SAMPLES`.
- Redis integration (ADR-012/013, black-hole resilience ADR-037): global
  `RedisModule` in `src/shared/redis/` with a single lazy ioredis 6 client
  (symbol token, `@InjectRedis()` escape hatch), `RedisService` application
  abstraction (get/set+TTL, UNLINK delete, exists/expire/ttl, atomic
  counters, bounded SCAN, PING), non-blocking startup connection, capped
  exponential backoff reconnection, graceful bounded shutdown, and a
  Terminus indicator that reports `degraded` (HTTP 200) when Redis is
  unreachable. Every command settles within `commandTimeout`
  (`REDIS_COMMAND_TIMEOUT_MS`, 5000 ms); the client explicitly sets
  `socketTimeout` (`REDIS_SOCKET_TIMEOUT_MS`, 6000 ms) — the black-hole
  recovery bound that destroys a silent in-flight socket and hands over to
  the bounded reconnect cycle, during which commands fail immediately
  (offline queue disabled) — plus explicit `enableReadyCheck` and
  `keepAlive` (30 s initial delay; detects idle-connection dead peers only
  after OS-scale minutes). The Terminus indicator runs through the coalesced
  `RedisHealthProbe` (`src/shared/redis/redis.probe.ts`, ADR-037):
  single-flight over PING with a process-local 5 s success / 3 s failure
  cache and a 3 s probe deadline, so floods cannot produce one command per
  request. Consumers: enrollments OTP storage, global rate limiting, and the
  idempotency store (ADR-039).
- PostgreSQL persistence (ADR-027): global `DatabaseModule` in
  `src/shared/database/` with MikroORM v7 (7.2.9; `@mikro-orm/nestjs` 7.1.0,
  `PostgreSqlDriver`, `autoLoadEntities`) reading `DATABASE_URL` and
  `DATABASE_POOL_MAX` from validated config. MikroORM v7 initializes without
  connecting, so an unreachable server never blocks startup; a bounded
  Terminus indicator named `postgres` reports `degraded` (HTTP 200) on
  `/health` and `down` (HTTP 503) on `/health/ready`, and the connection
  closes on application shutdown (`enableShutdownHooks()`). The pool is
  configured explicitly (ADR-036): `DATABASE_POOL_MAX` capacity (default 10),
  5 s connection timeout, 10 s idle timeout, TCP keepalive, and a
  server-enforced `statement_timeout` of 30 s as a runtime hang safety net
  (disabled for CLI migrations). After a successful boot, a
  pool-level lifecycle logger (`DatabaseLifecycleLogger`,
  `src/shared/database/database.lifecycle.ts`, ADR-034) logs new physical
  connections (info) and pool errors (warn) through the Pino-backed logger
  and removes its listeners in `beforeApplicationShutdown` — the ORM keeps
  sole ownership of closing the connection. The health probe itself
  (`DatabaseHealthProbe`, `src/shared/database/database.probe.ts`, ADR-036)
  is bounded end-to-end (3 s deadline covering acquisition and execution,
  server-enforced `statement_timeout` of 2 s scoped to the probe
  transaction), guarantees client release exactly once — a deadline or query
  failure releases the borrowed client with an error, which makes pg-pool
  evict and locally force-disconnect it, so a network black hole on an
  established connection cannot permanently hold a pool slot — and coalesces
  probes with a process-local cache (5 s success TTL, 3 s failure cooldown),
  so request floods cannot amplify into database work. Schema changes go
  exclusively through explicit migrations (folder
  `src/shared/database/migrations/`, CLI config `mikro-orm.config.ts`,
  scripts `pnpm db:migration:create/up/down`) — no schema synchronization.
  Existing migrations are immutable (never edit, delete, rename, or squash
  one; corrections are new forward migrations) and every migration passes
  the `migration-reviewer` subagent's structured review before the task
  completes (ADR-033, root "Database Entity and Migration Governance"). The
  first feature entity exists: `Enrollment`
  (`src/modules/enrollments/entities/enrollment.entity.ts`, table
  `enrollments`, registered by `EnrollmentsModule` via
  `MikroOrmModule.forFeature([Enrollment])`, ADR-041) — the shared abstract
  `BaseEntity` (ADR-029) base columns plus the core lifecycle fields:
  `phone_number` (canonical national format `09XXXXXXXXX`, `varchar(11)`
  with a format CHECK; E.164 is never stored), `public_id` (uuid NOT NULL,
  database-native `uuidv7()` default per ADR-040/041, unique, version-7
  CHECK — the only client-visible identifier, read back after insert),
  `status` (text, default `INITIAL`, in-list CHECK over 6 values),
  `current_step` (text, default `NATIONAL_CODE`, in-list CHECK over 9
  steps), and `expires_at` (`timestamptz(3)` NOT NULL, application-set
  `createdAt` + 24 h from one clock reading, deliberately no database
  default). The value lists and defaults come from the single-source enums
  (`enrollments.enums.ts`). Two migrations are applied to the dev Compose
  PostgreSQL: `Migration20261116181139` created the table and
  `Migration20261122000737` added the lifecycle columns and constraints,
  narrowed `phone_number` to `varchar(11)`, and created the
  `enrollments_phone_active_unique` partial unique index
  (`WHERE status <> 'EXPIRED'`) that — together with the class-level CHECKs
  — enforces the one-non-expired-Enrollment-per-phone invariant (ADR-041).
- Shared entity base and actor audit context (ADR-029): abstract `BaseEntity`
  (`src/shared/database/base.entity.ts`) inlined into every future entity —
  BIGINT `bigserial` id (TypeScript `string`, propagated `id > 0` check),
  `timestamptz(3)` timestamps, nullable `createdBy`/`updatedBy` audit
  scalars (no foreign keys), ORM-owned optimistic-locking `version`,
  `deletedAt` soft-delete surface. A per-request actor context
  (`src/shared/actor-context/`, the nestjs-cls `ClsModule` middleware —
  ADR-031) opens a request-scoped store and resolves audit attribution via
  `getActorId()`; with no authentication yet, every request is attributed
  to the system (`NULL`). Optimistic-lock conflicts map through
  `mapOptimisticLockError` (`src/shared/errors/optimistic-lock.mapper.ts`)
  to `ErrorCode.VersionConflict` (HTTP 409) with bilingual Problem Details.
  Covered by metadata tests (`base.entity.spec.ts`, 5 tests) and a
  database-tier spec (`test/base-entity.db-spec.ts`, 11 tests — see the
  Tests bullet).
- UTC-first storage policy (ADR-030): all timestamps are `timestamptz(3)`
  absolute instants (`forceUtcTimezone: true` explicit in the shared ORM
  options), the dev/prod Compose PostgreSQL services and the Testcontainers
  test image run pinned to `TZ: UTC`, and user-timezone conversion happens
  only at the presentation boundary via IANA zones.
  `calendarDayUtcRange` (`src/shared/datetime/utc-datetime.ts`) computes the
  exact UTC boundaries of user-local calendar days (DST-correct); the
  developer guide is `docs/utc-datetime.md`.
- Global HTTP rate limiting (ADR-015): official `@nestjs/throttler` (v6) with
  two named policies (`short`: 10 req/1s default; `long`: 100 req/1m default)
  backed by custom `RedisThrottlerStorage` using the shared Redis connection.
  Atomic Lua script evaluates block state before incrementing the counter
  (prevents nest-lab #74 re-arming). Custom `RedisThrottlerGuard` sets
  standard `Retry-After` and `X-RateLimit-*` headers on both success and 429.
  `@Throttle()`/`@SkipThrottle()` decorators with named throttler objects work
  correctly. Health/readiness endpoints skipped. No in-memory fallback —
  Redis failure = HTTP 500 (fail-closed). Routes marked `@DeferredRateLimit()`
  (ADR-039, currently the challenge endpoint) are skipped by the registered
  global guard — `DeferredRateLimitGuard`, a `RedisThrottlerGuard` subclass
  that honors the marker — and their quota is re-enforced by a route-level
  interceptor that runs after the idempotency acquire gate, so idempotent
  replays and in-flight duplicates never consume quota; every other route
  takes the unchanged global path. `pnpm test:redis` runs 89 real-Redis
  integration tests in 6 files (throttler atomicity/block/multi-instance
  behavior, the idempotency store contract — ADR-039 —, proxy/IPv6 behavior,
  Redis failure, black-hole fault injection).
- HTTP idempotency (ADR-039): the official `@nestjs/idempotency` (0.0.4) with
  a custom Redis-backed store (`src/shared/idempotency/` — four atomic Lua
  scripts registered via ioredis `defineCommand` on the shared client; one
  hash record per key at `neo-bank:idempotency:store:record:<sha256hex>`, the
  SHA-256 of the package's `<scope>:<key>`, so the stored key is fixed-length
  and carries no client-controlled content and no phone number). Applied to
  `POST /enrollments/challenge` via `@Idempotent()`: the `Idempotency-Key`
  header is required (`400 IDEMPOTENCY_KEY_REQUIRED`/`IDEMPOTENCY_KEY_INVALID`
  otherwise), the scope is HMAC-SHA-256(`IDEMPOTENCY_SCOPE_SECRET`, normalized
  phone) and the fingerprint is the normalized phone — equivalent phone
  spellings share one scope, and a key-reuse `422` is structurally unreachable
  on this endpoint because scope and fingerprint derive from the same
  normalized phone (still documented as contract). A completed result is
  replayable for 24 h; an in-flight lock lives 60 s (renewed every lockTtl/3)
  and answers concurrent duplicates with `409 IDEMPOTENCY_KEY_IN_USE` +
  `Retry-After` (1 s); `storeIf` stores every final outcome except 429 and
  5xx — a 429 is never stored (the key is released and a retry re-executes),
  a 5xx leaves the outcome ambiguous. Replays answer the stored result with
  `Idempotent-Replayed: true` (and `Retry-After` on the 409); both headers are
  CORS-exposed when CORS is enabled. Package rejections map onto
  `ErrorCode.IdempotencyKey*` in the Problem Details filter with localized
  en/fa titles and details. No in-memory fallback: a store failure fails the
  request closed (500 with a store-selection diagnostic in the log).
  Deployment prerequisite: production Redis must run
  `maxmemory-policy noeviction` (server default) — records are not evictable;
  the Compose stacks enforce an explicit `--maxmemory` bound (`1gb`
  production, `256mb` development) so the never-evicting recordspace has a
  fixed, alertable ceiling (security gate SEC-01).
- Logging: Pino via nestjs-pino (ADR-008/009), header redaction,
  `pino-pretty` in development only (an optional `LOG_PRETTY` env override
  forces either format; the dev Compose stack sets it to `false` so the
  containerized API logs structured JSON for centralized collection,
  ADR-022).
- Request IDs: UUIDv4, inbound `x-request-id` strictly validated (ADR-010).
- Response contracts: success envelope interceptor (ADR-011) and RFC 9457
  Problem Details error filter; `/problems/application-error` documentation
  page.
- `ZodValidationPipe` for body/param/query validation against Zod schemas.
- Internationalization (ADR-021): the official `@nestjs/i18n` with locales
  `en` (default) and `fa`, resolved per request by the
  `AcceptLanguageLocaleResolver` (the only active resolver; q-values,
  regional identifiers like `fa-IR` → base language, missing/unsupported →
  default). JSON catalogs in `src/i18n/{en,fa}/{common,errors,health,otp,
  validation}.json`, delivered to production via nest-cli assets into
  `dist/i18n`; the English catalog registers compile-time-checked keys
  (`src/i18n/i18n.types.ts`). Localized surfaces: envelope `message`,
  Problem Details `title`/`detail`, OTP error details, Zod validation
  messages, and the Redis/PostgreSQL health fallbacks — error codes,
  statuses, and all
  machine-readable values unchanged. Missing keys `throw` in
  development/test and fall back to English with diagnostics in production.
  Responses carry `Content-Language` and `Vary: Accept-Language`. The
  Adapter-level request-ID rejection stays English by design (runs before
  locale resolution). Catalog-consistency tests enforce key/placeholder/
  plural parity; `test/i18n.e2e-spec.ts` covers resolution, headers,
  localization, isolation, and health regression.
- Swagger/OpenAPI (ADR-014): development-only via `@nestjs/swagger` —
  Swagger UI at `/docs`, document at `/docs/json`/`/docs/yaml`; request
  schemas generated from Zod with `z.toJSONSchema()`; shared envelope and
  Problem Details response schemas; all existing endpoints documented.
- Liveness probe at `/health` (Terminus, version-neutral, outside the API
  prefix, unthrottled, `Cache-Control: no-store`) with Redis and PostgreSQL
  indicators: healthy, or `degraded` with HTTP 200 when either is unreachable
  — a degraded dependency never makes the process look dead. The PostgreSQL
  indicator runs through the coalescing, bounded probe engine (ADR-036), so
  concurrent requests share one database probe and results are served from a
  short-TTL process-local cache; the Redis indicator runs through its
  ADR-037 counterpart (`RedisHealthProbe`: single-flight, 5 s success / 3 s
  failure cache, 3 s deadline).
- Memory-based load shedding (ADR-026): `src/shared/memory-protection/`
  samples process RSS on a fixed interval
  (`MEMORY_PROTECTION_SAMPLE_INTERVAL_MS`, default 5000 ms) and maintains a
  hysteresis state machine — protection activates as soon as one sample
  reaches `MEMORY_PROTECTION_MAX_RSS_MB` (default 1024) and clears only after
  RSS stays below `MEMORY_PROTECTION_RECOVERY_RSS_MB` (default 768) for
  `MEMORY_PROTECTION_STABLE_SAMPLES` (default 3) consecutive samples
  (`MEMORY_PROTECTION_ENABLED` toggles the feature, default on). While
  active, a global `MemoryProtectionGuard` (registered before the Redis
  throttler guard so the rejection path needs no Redis) rejects non-exempt
  requests with 503 Problem Details (`SERVICE_UNAVAILABLE`, localized en/fa
  detail, `Retry-After` = seconds to the next sample); health endpoints and
  the Problem-Type docs page are exempt via `@SkipMemoryProtection()`.
- Readiness probe at `/health/ready` (ADR-026; version-neutral, outside the
  API prefix, unthrottled, `Cache-Control: no-store`): Terminus over strict
  Redis and PostgreSQL
  indicators (an unreachable Redis or PostgreSQL fails readiness) plus a
  memory indicator (down while memory protection is active) → HTTP 503 when
  any indicator is down, so orchestrators stop
  routing new traffic to the instance. The liveness endpoint deliberately
  excludes the memory indicator.
- Feature module `enrollments`: `POST /api/v1/enrollments/challenge` —
  validates an Iranian mobile number (with normalization for
  `+98`/`0098`/`98`/missing zero/whitespace), generates a cryptographically
  random 6-digit OTP (100000–999999), and stores only its HMAC-SHA-256 digest
  (`phone:otp` keyed with the dedicated `ENROLLMENTS_OTP_HMAC_SECRET`,
  ADR-018) — bound to a per-issuance UUIDv4 challenge ID — in Redis under
  `neo-bank:enrollments:challenge:otp:<phone>` with an exact 120-second TTL
  using atomic `SET NX EX` combined with a lockout check (prevents race
  conditions where concurrent requests could overwrite an existing OTP or
  extend its TTL, and an OTP is never issued while a verification lockout is
  active). The plaintext OTP never reaches Redis. The
  response is an empty `202 Accepted` — intentionally no envelope and no
  phone number (ADR-039); the OTP value is never returned and no SMS is
  sent. The endpoint is idempotent (see the idempotency bullet): a retry
  with the same `Idempotency-Key` replays the stored empty 202 without
  issuing a new OTP or consuming rate-limit quota.
- Feature module `enrollments`: `POST /api/v1/enrollments/verify` —
  validates the phone and a six-character numeric OTP (string, leading zeros
  preserved) with Zod before any Redis access, then compares the submitted
  OTP's HMAC digest against the stored digest with `crypto.timingSafeEqual`
  in Node.js and atomically resolves consumption and attempt counting via a
  Lua script that re-checks the lockout, the verified challenge's identity,
  and the OTP-key existence (ADR-018/019): a replaced challenge is never
  consumed, and verification without a live challenge creates no attempts or
  lockout state. Missing,
  expired, incorrect, and exhausted-attempt OTPs
  all return the identical generic `OTP_VERIFICATION_FAILED` Problem Details
  response. Failed attempts are counted up to a configurable maximum
  (`ENROLLMENTS_MAX_VERIFY_ATTEMPTS`, default 5); when reached, a lockout is
  set (`neo-bank:enrollments:challenge:lockout:<phone>`, TTL configurable via
  `ENROLLMENTS_LOCKOUT_TTL_SECONDS`, default 900 s / 15 min) that blocks both
  verification and new OTP issuance for the lockout window. The lockout is
  independent of the OTP TTL and cannot be bypassed by requesting a new OTP.
  Both endpoints keep their endpoint-specific per-IP limits aligned with the
  OTP window (challenge 2 req/120 s, verify 5 req/120 s) on top of the global
  policies; the challenge quota is enforced by the route-level
  `DeferredRateLimitInterceptor` after the idempotency acquire gate
  (ADR-039) — replays and in-flight duplicates consume no quota — while
  verify takes the unchanged global guard. An additional per-phone hourly
  rate limit (5 sends / rolling 60 min) is
  enforced atomically via Redis sorted set. No registration or authentication
  steps yet.
- Conditional requests (restored Fastify-era behavior, ADR-032; hardened and
  made opt-in by ADR-038): weak entity tags (`W/"<sha256>"`) composed over
  the serialized application payload **and the request's resolved locale** on
  every JSON response (envelope path, Problem Details path, and the bootstrap
  error paths alike — the locale composes into the hash because the envelope
  message and Problem Details titles are localized; the pre-i18n request-ID
  rejection carries no entity tag — its body embeds the client-supplied
  (validated, normalized) inbound request ID, so no client-influenced input
  is hashed into a response header), `If-None-Match` revalidation with 304
  for **decorated GET routes only** (`@ConditionalGet()`; weak comparison —
  unlike Fastify's strong envelope tags, which never matched in practice
  because of the per-response metadata, this revalidation works — strict
  RFC 9110 parsing in `if-none-match.ts`: quoted commas, safe-failure on
  malformed candidates, bounded input, `*` only as the entire field value)
  gated to successful (2xx) responses — undecorated routes, HEAD (§7),
  error-status routes, and redirects are never revalidated to 304; no
  revalidation for other methods; SSE, streams, and routes controlling their
  own non-JSON representation (declared or reply-set non-JSON content type,
  shared `json-content-type.ts` helpers with the envelope) are skipped;
  primitive payloads (strings, numbers) are tagged like records; every
  tagged response carries an explicit `Cache-Control: private, no-cache`
  (never overwriting an explicit declaration, echoed by the 304 per RFC
  9110 §15.4.5); the development Swagger documents the `If-None-Match`
  parameter and the bodyless `304` only for decorator-marked JSON-success
  GET operations (`x-conditional-get`); proxy trust is optionally narrowed
  by `TRUST_PROXY_PROXIES` (see the env table in `apps/api/ONBOARDING.md`).
- Tests: Vitest unit (54 files / 504 tests), e2e (17 files / 115 tests), Redis
  integration (6 files / 89 tests via `pnpm test:redis`), database
  integration (4 files / 36 tests via `pnpm test:db`,
  ADR-027/029/030/031/036/041 — `base-entity.db-spec.ts`,
  `enrollment.db-spec.ts` (the first feature entity: schema shape, the
  persistence round-trip with the database-generated version-7 `public_id`,
  the one-active-per-phone invariant, and the database-enforced column
  contracts), `database.db-spec.ts`,
  `database-health.db-spec.ts` (bounded probe: deadline eviction, exactly-once
  client release, single-flight/TTL cache, forced-failure recovery, and the
  Toxiproxy established-connection black-hole proof)). All integration
  and e2e tests use Testcontainers (`apps/api/test/testcontainers.ts`,
  ADR-016): the Redis and database integration tiers start isolated
  containers per test file (`redis:8.2-alpine`, `postgres:18.7-alpine`, plus
  `ghcr.io/shopify/toxiproxy:2.12.0` for the database and Redis black-hole
  fault-injection specs), and
  the e2e tier shares one Redis and one PostgreSQL container per test run
  via the Vitest globalSetup (`apps/api/test/e2e.global-setup.ts`, ADR-025) —
  e2e files run sequentially (`fileParallelism: false`, `test/vitest-e2e.config.ts`)
  because the rate-limit and idempotency scenarios assert exact Redis key
  state —
  all with dynamic ports; no manual Docker Compose required. Orchestration is
  Turborepo-native (ADR-035): root `pnpm test` runs all four tiers
  concurrently (Docker-backed tiers are never cached; the pre-push hook
  gates on all of them), and `pnpm test:coverage` adds unit-tier coverage
  (`@vitest/coverage-v8`, text/html/lcov reports under `apps/api/coverage/`;
  measured baseline ≈ 75% statements). Future workspaces join the pipeline
  by exposing the conventional `test`/`test:coverage` scripts. Unit and
  database counts verified 2026-11-22 (unit 504/504, database 36/36); e2e
  and Redis counts verified 2026-11-20 (e2e 115/115, Redis 89/89);
  integration-tier runs through the new
  orchestration and the pre-push failure proof are pending per
  `prompts/_052-*.md` (registry outage).

**Partial**

- `enrollments` module: the OTP is generated, stored (120s TTL), and
  verified atomically; the `Enrollment` entity carries the full ADR-041 core
  schema (lifecycle columns and the one-active-per-phone invariant index)
  and its `enrollments` table exists (registered via `forFeature`), but no
  flow writes rows yet — SMS delivery and the registration flow after
  verification are planned.

**Planned / Not started**

- Further persistence features (more entities/repositories — the
  persistence layer is implemented at infrastructure level and carries the
  first feature entity), authentication/authorization, remaining banking
  features, SMS provider integration.
- ADR-038 is fully implemented across its three phases: Phase 0 hardened
  the tag generation (locale-composed validators, 2xx gate, primitive
  tagging, shared JSON content-type helpers); Phase 1 centralized the
  OpenAPI transform and made a decided 304 serialize nothing; Phase 2 made
  revalidation opt-in (`@ConditionalGet()`), added the strict RFC 9110
  parser (`if-none-match.ts`), excluded HEAD, and narrowed the Swagger
  documentation to decorator-marked routes.

### `apps/web` — Next.js 16 customer app (scaffold)

**Implemented:** App Router layout + single index page rendering "Neo Bank";
oxlint config with nextjs plugin; typecheck/build/lint/format scripts.

**Planned / Not started:** everything else — API integration, routing,
state, styling, tests. No test script exists.

### `apps/admin` — Vite + React 19 dashboard (scaffold)

**Implemented:** single `App` component rendering "Neo Bank Admin";
project-reference tsconfig setup; oxlint config; lint/format/typecheck
(`tsc -b`) scripts.

**Planned / Not started:** everything else — API integration, routing,
auth-guarded dashboard, tests. No test script exists.

## Shared Packages

None. The workspace contains only `apps/*`; no `packages/` directory exists.

## Infrastructure and Integrations

**Implemented:** Redis client integration in the API (global `RedisModule`,
ioredis 6, degraded-mode health, standardized key naming); the enrollments
challenge feature stores its OTP in Redis; global rate limiting uses the same
connection via atomic Lua scripts, and so does the idempotency store
(ADR-039). PostgreSQL persistence is integrated in
the API (ADR-027, amended 2026-11-14): a global `DatabaseModule` with
MikroORM v7 — the initial connection is established during bootstrap with
bounded retries (5 attempts, capped backoff, per-attempt timeout; startup
fails if the database cannot be reached, and permanent authentication or
configuration errors are not retried), while post-boot outages keep
degraded-liveness/strict-readiness health, and a pool-level lifecycle
logger records new connections and pool errors (ADR-034); explicit
migrations only (immutable, migration-reviewer-gated — ADR-033); the first
feature entity `Enrollment` (table `enrollments`, ADR-041 core schema) exists
with migrations `Migration20261116181139` and `Migration20261122000737`
applied to dev; the dev and prod Compose stacks
inject `DATABASE_URL` into the API service and pin the PostgreSQL services
to UTC (`TZ: UTC`, ADR-030 — the Testcontainers test image does the same).
The development Compose stack runs
`redis/redis-stack:7.4.0-v8` (pinned; Redis server 7.4.7) with bundled Redis
Insight on port 8001
(ADR-020); the API logs the host-accessible Insight URL at startup when the
stack injects `REDIS_INSIGHT_URL`. It also runs MockServer
(`mockserver/mockserver:9.2.0`, ADR-024), a development-only HTTP mock for
resilience testing: expectations registered through its control API simulate
downstream failures (5xx responses, delays, failure-then-recovery sequences)
against a real endpoint; nothing depends on the service, no outgoing traffic
is redirected to it automatically, and the API only logs its injected
addresses (host and Compose network) at startup. It also runs pgAdmin 4
(`dpage/pgadmin4:9.19`, ADR-028), a development-only PostgreSQL web UI at
`http://localhost:5050` (default) whose `postgres` server definition is
auto-registered at startup from a rendered template; nothing depends on the
service. Testcontainers (ADR-016/025) provides isolated `redis:8.2-alpine` and
`postgres:18.7-alpine` containers
for integration and e2e tests — the Redis and database integration tiers start their own
container per test file (dynamic ports, `beforeAll`/`afterAll`; the database
tier via `pnpm test:db`), while the
e2e tier shares one Redis and one PostgreSQL container per test run via a Vitest globalSetup — no
manual Docker Compose for any tier. Docker
infrastructure (`docs/docker.md`): dev and prod Compose stacks with PostgreSQL
and Redis, per-app dev/prod images (`turbo prune`, non-root, hot reloading in
dev; Redis intentionally has no persistence volume). Centralized log
monitoring (ADR-022): an independent Compose stack (`docker/compose.monitoring.yml`,
project `neo-bank-monitoring`) runs version-pinned Grafana (loopback :3002),
Loki 3.7.9 (filesystem storage on a named volume, 7-day retention,
loopback :3100), and Grafana Alloy 1.21.0 — Alloy discovers the dev/prod
containers through the Docker socket, derives low-cardinality labels
(`env`, `service`, `container`, `level`), parses pino JSON, and ships to
Loki; Grafana provisions the Loki data source and an investigation
dashboard as code. All Compose services (dev, prod, monitoring) use bounded
json-file log rotation (10 MB × 3). Operations: `docs/observability/`.
Beyond that, only the build/test toolchain
itself: Turborepo local caching (`.turbo/`), Husky hooks, commitlint,
lint-staged.

**Planned / Not started:** SMS provider, remote Turborepo cache,
CI pipeline, deployment targets, metrics (Prometheus), tracing (Tempo /
OpenTelemetry), alerting — see `docs/observability/README.md` roadmap.

## Commands

Root (Turborepo delegates to all workspaces that implement a script):

```sh
pnpm install --frozen-lockfile   # setup (pnpm 12.10.1, Node >=24.15 <25)
pnpm dev                         # all dev servers (not cached)
pnpm build                       # build all
pnpm lint                        # Oxlint in all workspaces
pnpm format                      # Oxfmt over the whole repo
pnpm format:check
pnpm typecheck                   # tsc per workspace
pnpm test                        # all test tiers (unit + e2e + redis + db) concurrently via turbo
pnpm test:e2e                    # api e2e only (needs Docker)
pnpm test:redis                  # api Redis integration only (needs Docker)
pnpm test:db                     # api database integration only (needs Docker)
pnpm test:coverage               # api unit tests + Vitest coverage (text/html/lcov in apps/api/coverage/)
pnpm docker:dev                  # full Docker dev stack in the background
pnpm docker:prod                 # full Docker production stack in the background
pnpm docker:monitoring           # Grafana + Loki + Alloy (centralized logs)
pnpm docker:monitoring:down      # stop the monitoring stack
pnpm docker:monitoring:logs      # follow monitoring container logs
pnpm clean
pnpm cm                          # Commitizen (Conventional Commits)
```

Per-app commands are listed in each `apps/<app>/ONBOARDING.md`.

## Known Technical Limitations

- TypeScript is pinned to `6.0.3` because the Nest CLI needs the TypeScript
  compiler API that TypeScript 7 stopped exposing (noted in root `README.md`).
- API `env/` files are gitignored except `.env.example`; fresh clones must
  copy it (see `apps/api/ONBOARDING.md`).
- Vitest resolves the API's `#` subpath aliases through
  `apps/api/test/subpath-import-aliases.ts`; new top-level `#` aliases must be
  added there as well as in `apps/api/package.json`.
- No authentication exists yet: the actor-extraction seam
  (`resolveActorId` in `src/shared/actor-context/actor-context.module.ts`)
  resolves no identity, so the shared BaseEntity's
  audit columns (`createdBy`/`updatedBy`) are always `NULL` (system
  attribution) until authentication lands (ADR-029, ADR-031).
- The pre-push hook runs the full test suite; pushes fail if it fails.

## Accepted Architectural Decisions

All ADRs live in [DECISIONS.md](../DECISIONS.md). Status as of this snapshot:

- **Accepted:** ADR-001 (Turborepo), ADR-002 (Fastify — superseded by ADR-032), ADR-003 (SWC), ADR-004 (@nestjs/config + Zod), ADR-005 (URI versioning), ADR-006 (1 MiB body limit), ADR-007 (`api` prefix), ADR-008/009 (Pino / nestjs-pino), ADR-010 (UUIDv4 request IDs), ADR-011 (envelope exclusions), ADR-012 (ioredis without a wrapper), ADR-013 (Redis module architecture), ADR-014 (Swagger/OpenAPI, development-only), ADR-015 (Global HTTP rate limiting with Redis-backed @nestjs/throttler), ADR-016 (Testcontainers for integration and e2e testing), ADR-017 (OTP verification attempt lockout for enrollment security), ADR-018 (HMAC-SHA-256 digest storage for enrollment OTPs), ADR-019 (OTP verification hardening — conditional attempt counting and challenge identity), ADR-020 (development Redis service migrated to Redis Stack with bundled Redis Insight), ADR-021 (bilingual internationalization en/fa via the official @nestjs/i18n), ADR-022 (centralized logging with Grafana Alloy, Loki, and Grafana), ADR-023 (project-level multi-agent development workflow for ZCode + Claude Code), ADR-024 (MockServer for development-time resilience testing), ADR-025 (managing the e2e Redis with Testcontainers — one shared container per run), ADR-026 (memory-based load shedding and health-aware readiness), ADR-027 (Use MikroORM v7 with PostgreSQL for Persistence), ADR-028 (pgAdmin 4 as the development-only PostgreSQL web UI), ADR-029 (Shared MikroORM BaseEntity with Actor Audit Context and Native Optimistic Locking), ADR-030 (UTC-First TIMESTAMPTZ Storage Policy), ADR-031 (Use nestjs-cls for the Application Actor Context), ADR-032 (Migrate the API HTTP Platform from Fastify to the NestJS NodeAdapter — supersedes ADR-002), ADR-033 (Immutable Migration Policy and Dedicated Migration Reviewer), ADR-034 (Database Connection Lifecycle Logging via the pg Pool), ADR-035 (Centralized Monorepo Test Orchestration, Parallel Execution, and Vitest Coverage via Turborepo), ADR-036 (Bounded, Coalesced Database Health Probes and Explicit PostgreSQL Pool Configuration), ADR-037 (Bounded Redis Commands, Black-Hole Recovery, and Coalesced Redis Health Probes), ADR-038 (Opt-In Conditional GET with RFC 9110 If-None-Match, Hardened ETag Generation, and a 304-Aware Response Envelope), ADR-039 (Redis-Backed Idempotency for the Enrollment Challenge with a Deferred Rate-Limit Enforcement Layer), ADR-040 (PostgreSQL 18 Upgrade for Native UUIDv7 Generation), ADR-041 (Enrollment Core Data Model — Canonical Phone Storage, the One-Active-Per-Phone Invariant, and a Database-Native UUIDv7 Public Identifier).

All architectural decisions are accepted and implemented. Do not build on rejected alternatives (e.g. do not introduce header versioning or a second logger).
