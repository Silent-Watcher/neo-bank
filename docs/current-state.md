# Current Development State

Snapshot of what exists in the repository. Last verified: 2026-11-14.
Legend: **Implemented** / **Partial** / **Planned** / **Unknown**.

## Maturity

Early-stage pre-product. The backend has real infrastructure (config, logging,
error contracts, request IDs, a Redis integration module, a PostgreSQL
persistence layer) and one small feature; both frontends are untouched
framework scaffolds. No auth, no deployment setup; the persistence layer is
infrastructure-only (no entities yet).

## Applications

### `apps/api` — NestJS + Fastify backend (active)

**Implemented**

- Bootstrap in `src/main.ts`: Fastify adapter with `trustProxy`, `bodyLimit`,
  request-ID generation, global `api` prefix, URI versioning (`/api/v1`),
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
  `APP_ENV`, `HOST`, `PORT`, `CORS_ORIGIN`, `TRUST_PROXY`, `BODY_LIMIT`,
  `DATABASE_URL`, `LOG_LEVEL`, `REDIS_URL`, `REDIS_USERNAME`, `REDIS_PASSWORD`,
  `REDIS_DB`,
  `REDIS_TLS`, `REDIS_CONNECT_TIMEOUT_MS`, `REDIS_COMMAND_TIMEOUT_MS`,
  `REDIS_MAX_RETRIES_PER_REQUEST`, `REDIS_SHUTDOWN_TIMEOUT_MS`,
  `RATE_LIMIT_SHORT_LIMIT`, `RATE_LIMIT_SHORT_TTL_SECONDS`,
  `RATE_LIMIT_LONG_LIMIT`, `RATE_LIMIT_LONG_TTL_MINUTES`,
  `ENROLLMENTS_MAX_VERIFY_ATTEMPTS`, `REDIS_INSIGHT_URL`,
  `MOCKSERVER_HOST_URL`, `MOCKSERVER_DOCKER_URL`, `LOG_PRETTY`,
  `MEMORY_PROTECTION_ENABLED`, `MEMORY_PROTECTION_MAX_RSS_MB`,
  `MEMORY_PROTECTION_RECOVERY_RSS_MB`, `MEMORY_PROTECTION_SAMPLE_INTERVAL_MS`,
  `MEMORY_PROTECTION_STABLE_SAMPLES`.
- Redis integration (ADR-012/013): global `RedisModule` in
  `src/shared/redis/` with a single lazy ioredis 6 client (symbol token,
  `@InjectRedis()` escape hatch), `RedisService` application abstraction
  (get/set+TTL, UNLINK delete, exists/expire/ttl, atomic counters, bounded
  SCAN, PING), non-blocking startup connection, capped exponential backoff
  reconnection, graceful bounded shutdown, and a Terminus indicator that
  reports `degraded` (HTTP 200) when Redis is unreachable. Consumers:
  enrollments OTP storage and global rate limiting.
- PostgreSQL persistence (ADR-027): global `DatabaseModule` in
  `src/shared/database/` with MikroORM v7 (7.2.9; `@mikro-orm/nestjs` 7.1.0,
  `PostgreSqlDriver`, `autoLoadEntities`) reading `DATABASE_URL` from
  validated config. MikroORM v7 initializes without connecting, so an
  unreachable server never blocks startup; a bounded (5 s) Terminus
  indicator named `postgres` reports `degraded` (HTTP 200) on `/health` and
  `down` (HTTP 503) on `/health/ready`, and the connection closes on
  application shutdown (`enableShutdownHooks()`). Schema changes go
  exclusively through explicit migrations (folder
  `src/shared/database/migrations/`, CLI config `mikro-orm.config.ts`,
  scripts `pnpm db:migration:create/up/down`) — no schema synchronization.
  Infrastructure level only: no entities exist yet.
- Global HTTP rate limiting (ADR-015): official `@nestjs/throttler` (v6) with
  two named policies (`short`: 10 req/1s default; `long`: 100 req/1m default)
  backed by custom `RedisThrottlerStorage` using the shared Redis connection.
  Atomic Lua script evaluates block state before incrementing the counter
  (prevents nest-lab #74 re-arming). Custom `RedisThrottlerGuard` sets
  standard `Retry-After` and `X-RateLimit-*` headers on both success and 429.
  `@Throttle()`/`@SkipThrottle()` decorators with named throttler objects work
  correctly. Health/readiness endpoints skipped. No in-memory fallback —
  Redis failure = HTTP 500 (fail-closed). `pnpm test:redis` runs 60 real-Redis
  integration tests (atomicity, block regression, multi-instance sharing,
  proxy/IPv6 behavior, Redis failure).
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
  Fastify-level request-ID rejection stays English by design (runs before
  locale resolution). Catalog-consistency tests enforce key/placeholder/
  plural parity; `test/i18n.e2e-spec.ts` covers resolution, headers,
  localization, isolation, and health regression.
- Swagger/OpenAPI (ADR-014): development-only via `@nestjs/swagger` —
  Swagger UI at `/docs`, document at `/docs/json`/`/docs/yaml`; request
  schemas generated from Zod with `z.toJSONSchema()`; shared envelope and
  Problem Details response schemas; all existing endpoints documented.
- Liveness probe at `/health` (Terminus, version-neutral, outside the API
  prefix, unthrottled) with Redis and PostgreSQL indicators: healthy, or
  `degraded` with HTTP 200 when either is unreachable — a degraded
  dependency never makes the process look dead.
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
  API prefix, unthrottled): Terminus over strict Redis and PostgreSQL
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
  response contains only the phone number; the OTP value is never
  returned and no SMS is sent.
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
  Both endpoints are protected by the global rate limiter with endpoint-specific
  limits aligned to the OTP window: challenge 2 req/120s, verify 5 req/120s.
  An additional per-phone hourly rate limit (5 sends / rolling 60 min) is
  enforced atomically via Redis sorted set. No registration or authentication
  steps yet.
- Tests: Vitest unit (334 tests), e2e (15 files / 83 tests), Redis
  integration (4 files / 60 tests via `pnpm test:redis`), database
  integration (1 file / 4 tests via `pnpm test:db`, ADR-027). All integration
  and e2e tests use Testcontainers (`apps/api/test/testcontainers.ts`,
  ADR-016): the Redis and database integration tiers start isolated
  containers per test file (`redis:8.2-alpine`, `postgres:17.6-alpine`), and
  the e2e tier shares one Redis and one PostgreSQL container per test run
  via the Vitest globalSetup
  (`apps/api/test/e2e.global-setup.ts`, ADR-025) — all with dynamic ports;
  no manual Docker Compose required.

**Partial**

- `enrollments` module: the OTP is generated, stored (120s TTL), and
  verified atomically; SMS delivery and the registration flow after
  verification are planned.

**Planned / Not started**

- Persistence features (entities/repositories — the persistence layer itself
  is implemented at infrastructure level), authentication/authorization,
  remaining banking features, SMS provider integration.

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
connection via atomic Lua scripts. PostgreSQL persistence is integrated in
the API (ADR-027, amended 2026-11-14): a global `DatabaseModule` with
MikroORM v7 — the initial connection is established during bootstrap with
bounded retries (5 attempts, capped backoff, per-attempt timeout; startup
fails if the database cannot be reached, and permanent authentication or
configuration errors are not retried), while post-boot outages keep
degraded-liveness/strict-readiness health; explicit migrations only — at
infrastructure level (no entities yet); the dev and prod Compose stacks
inject `DATABASE_URL` into the API service. The development Compose stack runs
`redis/redis-stack:7.4.0-v8` (pinned; Redis server 7.4.7) with bundled Redis
Insight on port 8001
(ADR-020); the API logs the host-accessible Insight URL at startup when the
stack injects `REDIS_INSIGHT_URL`. It also runs MockServer
(`mockserver/mockserver:9.2.0`, ADR-024), a development-only HTTP mock for
resilience testing: expectations registered through its control API simulate
downstream failures (5xx responses, delays, failure-then-recovery sequences)
against a real endpoint; nothing depends on the service, no outgoing traffic
is redirected to it automatically, and the API only logs its injected
addresses (host and Compose network) at startup. Testcontainers (ADR-016/025) provides isolated `redis:8.2-alpine` and
`postgres:17.6-alpine` containers
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
pnpm test                        # unit tests (api only) + e2e via turbo
pnpm test:e2e                    # api e2e only
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
- The pre-push hook runs the full test suite; pushes fail if it fails.

## Accepted Architectural Decisions

All ADRs live in [DECISIONS.md](../DECISIONS.md). Status as of this snapshot:

- **Accepted:** ADR-001 (Turborepo), ADR-002 (Fastify), ADR-003 (SWC), ADR-004 (@nestjs/config + Zod), ADR-005 (URI versioning), ADR-006 (1 MiB body limit), ADR-007 (`api` prefix), ADR-008/009 (Pino / nestjs-pino), ADR-010 (UUIDv4 request IDs), ADR-011 (envelope exclusions), ADR-012 (ioredis without a wrapper), ADR-013 (Redis module architecture), ADR-014 (Swagger/OpenAPI, development-only), ADR-015 (Global HTTP rate limiting with Redis-backed @nestjs/throttler), ADR-016 (Testcontainers for integration and e2e testing), ADR-017 (OTP verification attempt lockout for enrollment security), ADR-018 (HMAC-SHA-256 digest storage for enrollment OTPs), ADR-019 (OTP verification hardening — conditional attempt counting and challenge identity), ADR-020 (development Redis service migrated to Redis Stack with bundled Redis Insight), ADR-021 (bilingual internationalization en/fa via the official @nestjs/i18n), ADR-022 (centralized logging with Grafana Alloy, Loki, and Grafana), ADR-023 (project-level multi-agent development workflow for ZCode + Claude Code), ADR-024 (MockServer for development-time resilience testing), ADR-025 (managing the e2e Redis with Testcontainers — one shared container per run), ADR-026 (memory-based load shedding and health-aware readiness), ADR-027 (Use MikroORM v7 with PostgreSQL for Persistence).

All architectural decisions are accepted and implemented. Do not build on rejected alternatives (e.g. do not introduce header versioning or a second logger).
