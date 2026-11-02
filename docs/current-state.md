# Current Development State

Snapshot of what exists in the repository. Last verified: 2026-11-02.
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
  CORS from validated config.
- Configuration system: Zod-validated env (ADR-004), env files in
  `env/` (`.env.development`, `.env.test`, `.env.example`), namespaced
  `registerAs` factories, fail-fast validation. Validated variables:
  `APP_ENV`, `HOST`, `PORT`, `CORS_ORIGIN`, `TRUST_PROXY`, `BODY_LIMIT`,
  `LOG_LEVEL`, `REDIS_URL`, `REDIS_USERNAME`, `REDIS_PASSWORD`, `REDIS_DB`,
  `REDIS_TLS`, `REDIS_CONNECT_TIMEOUT_MS`, `REDIS_COMMAND_TIMEOUT_MS`,
  `REDIS_MAX_RETRIES_PER_REQUEST`, `REDIS_SHUTDOWN_TIMEOUT_MS`.
- Redis integration (ADR-012/013): global `RedisModule` in
  `src/shared/redis/` with a single lazy ioredis 6 client (symbol token,
  `@InjectRedis()` escape hatch), `RedisService` application abstraction
  (get/set+TTL, UNLINK delete, exists/expire/ttl, atomic counters, bounded
  SCAN, PING), non-blocking startup connection, capped exponential backoff
  reconnection, graceful bounded shutdown, and a Terminus indicator that
  reports `degraded` (HTTP 200) when Redis is unreachable. No feature uses
  it yet (planned for OTP storage).
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
  random 6-digit OTP (100000–999999), and stores it in Redis under
  `neo-bank:enrollments:challenge:otp:<phone>` with an exact 120-second TTL.
  The response contains only the phone number; the OTP value is never
  returned and no SMS is sent.
- Feature module `enrollments`: `POST /api/v1/enrollments/verify` —
  validates the phone and a six-character numeric OTP (string, leading zeros
  preserved) with Zod before any Redis access, then atomically verifies and
  consumes the stored code via a single Lua script (read-compare-UNLINK).
  Missing, expired, and incorrect OTPs all return the identical generic
  `OTP_VERIFICATION_FAILED` Problem Details response. No registration or
  authentication steps yet.
- Tests: Vitest unit (24 files / 178 tests) and e2e (13 files / 62 tests).

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
challenge feature stores its OTP in Redis. Beyond that,
only the build/test toolchain itself: Turborepo local caching (`.turbo/`),
Husky hooks, commitlint, lint-staged.

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

## Pending Architectural Decisions

All ADRs live in [DECISIONS.md](../DECISIONS.md). Status as of this snapshot:

- **Accepted:** ADR-001 (Turborepo), ADR-002 (Fastify), ADR-003 (SWC).
- **Pending:** ADR-004 (@nestjs/config + Zod), ADR-005 (URI versioning),
  ADR-006 (1 MiB body limit), ADR-007 (`api` prefix), ADR-008/009 (Pino /
  nestjs-pino), ADR-010 (UUIDv4 request IDs), ADR-011 (envelope exclusions),
  ADR-012 (ioredis without a wrapper), ADR-013 (Redis module architecture),
  ADR-014 (Swagger/OpenAPI, development-only).

The pending ADRs are implemented in code but not yet formally accepted; do not
build on their alternatives (e.g. do not introduce header versioning or a
second logger).
