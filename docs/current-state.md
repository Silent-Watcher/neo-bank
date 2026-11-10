# Current Development State

Snapshot of what exists in the repository. Last verified: 2026-11-10.
Legend: **Implemented** / **Partial** / **Planned** / **Unknown**.

## Maturity

Early-stage pre-product. The backend has real infrastructure (config, logging,
error contracts, request IDs, a Redis integration module) and one small
feature; both frontends are untouched framework scaffolds. No database, no
auth, no deployment setup.

## Applications

### `apps/api` — NestJS + Fastify backend (active)

**Implemented**

- Bootstrap in `src/main.ts`: Fastify adapter with `trustProxy`, `bodyLimit`,
  request-ID generation, global `api` prefix, URI versioning (`/api/v1`),
  CORS from validated config. After a successful listen, the API logs its
  address (`http://<address>:<port>/api/v1`, loopback plus non-internal
  interface addresses for the wildcard host) and, in development only, the
  Swagger UI address — always plain `http`, since no TLS or reverse proxy
  fronts the API.
- Configuration system: Zod-validated env (ADR-004), env files in
  `env/` (`.env.development`, `.env.test`, `.env.example`, `.env.redis-test`),
  namespaced `registerAs` factories, fail-fast validation. Validated variables:
  `APP_ENV`, `HOST`, `PORT`, `CORS_ORIGIN`, `TRUST_PROXY`, `BODY_LIMIT`,
  `LOG_LEVEL`, `REDIS_URL`, `REDIS_USERNAME`, `REDIS_PASSWORD`, `REDIS_DB`,
  `REDIS_TLS`, `REDIS_CONNECT_TIMEOUT_MS`, `REDIS_COMMAND_TIMEOUT_MS`,
  `REDIS_MAX_RETRIES_PER_REQUEST`, `REDIS_SHUTDOWN_TIMEOUT_MS`,
  `RATE_LIMIT_SHORT_LIMIT`, `RATE_LIMIT_SHORT_TTL_SECONDS`,
  `RATE_LIMIT_LONG_LIMIT`, `RATE_LIMIT_LONG_TTL_MINUTES`,
  `ENROLLMENTS_MAX_VERIFY_ATTEMPTS`, `REDIS_INSIGHT_URL`.
- Redis integration (ADR-012/013): global `RedisModule` in
  `src/shared/redis/` with a single lazy ioredis 6 client (symbol token,
  `@InjectRedis()` escape hatch), `RedisService` application abstraction
  (get/set+TTL, UNLINK delete, exists/expire/ttl, atomic counters, bounded
  SCAN, PING), non-blocking startup connection, capped exponential backoff
  reconnection, graceful bounded shutdown, and a Terminus indicator that
  reports `degraded` (HTTP 200) when Redis is unreachable. Consumers:
  enrollments OTP storage and global rate limiting.
- Global HTTP rate limiting (ADR-015): official `@nestjs/throttler` (v6) with
  two named policies (`short`: 10 req/1s default; `long`: 100 req/1m default)
  backed by custom `RedisThrottlerStorage` using the shared Redis connection.
  Atomic Lua script evaluates block state before incrementing the counter
  (prevents nest-lab #74 re-arming). Custom `RedisThrottlerGuard` sets
  standard `Retry-After` and `X-RateLimit-*` headers on both success and 429.
  `@Throttle()`/`@SkipThrottle()` decorators with named throttler objects work
  correctly. Health/readiness endpoints skipped. No in-memory fallback —
  Redis failure = HTTP 500 (fail-closed). `pnpm test:redis` runs 32 real-Redis
  integration tests (atomicity, block regression, multi-instance sharing,
  proxy/IPv6 behavior, Redis failure).
- Logging: Pino via nestjs-pino (ADR-008/009), header redaction,
  `pino-pretty` in development only.
- Request IDs: UUIDv4, inbound `x-request-id` strictly validated (ADR-010).
- Response contracts: success envelope interceptor (ADR-011) and RFC 9457
  Problem Details error filter; `/problems/application-error` documentation
  page.
- `ZodValidationPipe` for body/param/query validation against Zod schemas.
- Swagger/OpenAPI (ADR-014): development-only via `@nestjs/swagger` —
  Swagger UI at `/docs`, document at `/docs/json`/`/docs/yaml`; request
  schemas generated from Zod with `z.toJSONSchema()`; shared envelope and
  Problem Details response schemas; all existing endpoints documented.
- Health check at `/health` (Terminus) with a Redis indicator: healthy,
  or `degraded` with HTTP 200 when Redis is unreachable.
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
- Tests: Vitest unit (29 files / 245 tests), e2e (13 files / 65 tests),
  Redis integration (4 files / 60 tests via `pnpm test:redis`). All integration
  and e2e tests use Testcontainers (`apps/api/test/testcontainers.ts`) to
  start isolated `redis:8.2-alpine` containers per test file with dynamic
  ports — no manual Docker Compose required.

**Partial**

- `enrollments` module: the OTP is generated, stored (120s TTL), and
  verified atomically; SMS delivery and the registration flow after
  verification are planned.

**Planned / Not started**

- Persistence, authentication/authorization, remaining banking features,
  rate limiting, SMS provider integration.

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
connection via atomic Lua scripts. The development Compose stack runs
`redis/redis-stack:latest` with bundled Redis Insight on port 8001
(ADR-020); the API logs the host-accessible Insight URL at startup when the
stack injects `REDIS_INSIGHT_URL`. Testcontainers (ADR-016) provides isolated
`redis:8.2-alpine` containers for integration and e2e tests — each test file
starts its own container with dynamic ports in `beforeAll`/`afterAll`, enabling
parallel execution and true isolation without manual Docker Compose. Docker
infrastructure (`docs/docker.md`): dev and prod Compose stacks with PostgreSQL
and Redis, per-app dev/prod images (`turbo prune`, non-root, hot reloading in
dev; Redis intentionally has no persistence volume). Beyond that, only the
build/test toolchain itself: Turborepo local caching (`.turbo/`), Husky hooks,
commitlint, lint-staged.

**Planned / Not started:** database, SMS provider, remote Turborepo cache,
CI pipeline, deployment targets.

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

- **Accepted:** ADR-001 (Turborepo), ADR-002 (Fastify), ADR-003 (SWC), ADR-004 (@nestjs/config + Zod), ADR-005 (URI versioning), ADR-006 (1 MiB body limit), ADR-007 (`api` prefix), ADR-008/009 (Pino / nestjs-pino), ADR-010 (UUIDv4 request IDs), ADR-011 (envelope exclusions), ADR-012 (ioredis without a wrapper), ADR-013 (Redis module architecture), ADR-014 (Swagger/OpenAPI, development-only), ADR-015 (Global HTTP rate limiting with Redis-backed @nestjs/throttler), ADR-016 (Testcontainers for integration and e2e testing), ADR-017 (OTP verification attempt lockout for enrollment security), ADR-018 (HMAC-SHA-256 digest storage for enrollment OTPs), ADR-019 (OTP verification hardening — conditional attempt counting and challenge identity), ADR-020 (development Redis service migrated to Redis Stack with bundled Redis Insight).

All architectural decisions are accepted and implemented. Do not build on rejected alternatives (e.g. do not introduce header versioning or a second logger).
