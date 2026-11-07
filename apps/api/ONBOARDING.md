# ONBOARDING.md — apps/api

Developer onboarding guide for the Neo Bank backend API. Written for someone
who has never seen this repository.

## 1. Introduction

This application is the backend of Neo Bank, a banking product in early
development. It is a REST API built with NestJS 12 running on Fastify
instead of Express. It currently serves health checks, a Problem Type
documentation page, and the first feature (enrollment challenge: it
validates a phone number, stores a six-digit OTP in Redis for 120 seconds,
and a verify endpoint consumes the stored code atomically; verification
failures are deliberately generic). Delivery via SMS and the registration
steps after verification are not implemented yet. It has no database; Redis
is its only external store.

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
| Pino / nestjs-pino                       | Structured logging; request-scoped context, header redaction                                            |
| @nestjs/terminus                         | `/health` endpoint                                                                                      |
| ioredis 6                                | Redis client behind the shared `RedisService` ([ADR-012](../../DECISIONS.md)/[013](../../DECISIONS.md)) |
| @nestjs/swagger + @fastify/static        | OpenAPI docs; Swagger UI at `/docs`, **development only** ([ADR-014](../../DECISIONS.md))               |
| Vitest + supertest                       | Unit and e2e testing                                                                                    |
| Oxlint / Oxfmt                           | Linting and formatting (no ESLint/Prettier)                                                             |

## 3. Prerequisites

- Node.js **24.20.0** (allowed range `>=24.15 <25`; see `/.nvmrc`).
- pnpm **12.10.1** (enabled via `packageManager` in the root `package.json`;
  use `corepack enable` if pnpm is missing).
- A Redis server (≥ 4.0, required for `UNLINK`) is needed for Redis-backed
  features (enrollments OTP, global rate limiting), but the API starts without
  one: connection settings are validated at boot, and an unreachable server
  only degrades `/health`. Guarded routes fail closed (HTTP 500) when Redis
  is unreachable — no in-memory fallback.

## 4. Getting Started

All commands are run from this directory (`apps/api`) unless noted. To install
the whole workspace, run `pnpm install --frozen-lockfile` once at the repo
root.

**Configure environment variables** — env files are gitignored:

```sh
cp env/.env.example env/.env.development
# edit values if needed; defaults work for local development
```

| Variable                           | Meaning                                   | Default behavior if unset                         |
| ---------------------------------- | ----------------------------------------- | ------------------------------------------------- |
| `APP_ENV`                          | `development` \| `production` \| `test`   | required                                          |
| `HOST`, `PORT`                     | Bind address and port                     | required (dev/test files set `3001`)              |
| `CORS_ORIGIN`                      | Comma-separated allowed origins           | CORS disabled; required when `APP_ENV=production` |
| `TRUST_PROXY`                      | Trust proxy headers (`true`/`false`)      | `false`                                           |
| `BODY_LIMIT`                       | Max request body bytes                    | `1048576` (1 MiB)                                 |
| `LOG_LEVEL`                        | Pino level                                | `info`                                            |
| `REDIS_URL`                        | Redis URL (`redis://` or `rediss://`)     | required                                          |
| `REDIS_USERNAME`, `REDIS_PASSWORD` | Redis ACL credentials                     | required; empty value = no authentication         |
| `REDIS_DB`                         | Logical database index (0–15)             | server default                                    |
| `REDIS_TLS`                        | Force TLS for `redis://` (`true`/`false`) | `false` (`rediss://` always uses TLS)             |
| `REDIS_CONNECT_TIMEOUT_MS`         | Connection timeout (ms)                   | `10000`                                           |
| `REDIS_COMMAND_TIMEOUT_MS`         | Per-command timeout (ms)                  | `5000`                                            |
| `REDIS_MAX_RETRIES_PER_REQUEST`    | Command retry budget                      | `3`                                               |
| `REDIS_SHUTDOWN_TIMEOUT_MS`        | Graceful-QUIT window (ms)                 | `2000`                                            |
| `RATE_LIMIT_SHORT_LIMIT`           | Short-window max requests                 | `10`                                              |
| `RATE_LIMIT_SHORT_TTL_SECONDS`     | Short-window TTL in seconds               | `1`                                               |
| `RATE_LIMIT_LONG_LIMIT`            | Long-window max requests                  | `100`                                             |
| `RATE_LIMIT_LONG_TTL_MINUTES`      | Long-window TTL in minutes                | `1`                                               |

Startup fails fast with a readable Zod error if validation fails.

**Run locally:**

```sh
pnpm dev          # watch mode on http://localhost:3001
```

Verify with `curl http://localhost:3001/health`.

**Run tests:**

```sh
pnpm test         # unit tests (Vitest)
pnpm test:e2e     # e2e suite (uses env/.env.test automatically)
pnpm test:redis   # Redis integration tests (uses env/.env.redis-test; requires running Redis)
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
  modules/
    app/                   # AppModule wiring, health check, Problem Type docs page
    enrollments/           # first feature module (OTP endpoint)
  shared/
    config/                # config.ts wiring, env/ Zod schemas, registerAs factories
    enums/                 # AppEnv enum
    errors/                # AppHttpException, ErrorCode, Problem Details helpers
    filters/               # global Problem Details error filter
    http/                  # request-ID generation/lifecycle, API version helpers
    interceptors/          # global success response envelope
    logging/               # nestjs-pino module and pino-http options
    pipes/                 # ZodValidationPipe
    redis/                 # global RedisModule: ioredis provider, RedisService,
                           # @InjectRedis(), degraded-mode health indicator
    swagger/               # dev-only OpenAPI setup + shared response schemas
test/                      # e2e specs + create-test-app.ts + Vitest alias map
env/                       # .env.development / .env.test / .env.example
```

**Where new features go:** create `src/modules/<feature>/` with a module,
controller, service, Zod schemas, and co-located `*.spec.ts` files, then
register the module in `src/modules/app/app.module.ts`. Cross-cutting code
that a second feature would need belongs in `src/shared/`.

**Routes:** every controller gets `/api/v1` automatically (global prefix +
URI versioning, [ADR-005](../../DECISIONS.md)/[ADR-007](../../DECISIONS.md)).
Only `/health` and `/problems/application-error` sit outside the prefix.

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
- Several ADRs ([../../DECISIONS.md](../../DECISIONS.md)) are **Pending**
  but implemented — follow them; don't reintroduce alternatives.

## 8. Useful Commands

```sh
pnpm dev                       # dev server with watch + env/.env.development
pnpm build                     # production build (SWC → dist/)
pnpm start                     # run the built app
pnpm test                      # unit tests
pnpm test:e2e                  # e2e tests (env/.env.test)
pnpm test:redis                # Redis integration tests (env/.env.redis-test)
pnpm lint                      # Oxlint
pnpm format                    # Oxfmt (write)
pnpm format:check              # Oxfmt (check only)
pnpm typecheck                 # tsc --noEmit
pnpm clean                     # remove dist/
```

### Docker Compose Commands

Run from the `apps/api` directory (uses `--project-directory ..` to target repo-root Compose files).

**Development (hot reloading, all services with bind mounts):**

```sh
pnpm docker:dev                # start dev stack (neo-bank-dev project)
pnpm docker:dev:down           # stop dev stack
```

**Production (hardened images, internal network, no exposed infrastructure ports):**

```sh
pnpm docker:prod               # start prod stack (neo-bank-prod project) in background
pnpm docker:prod:down          # stop prod stack
```

**Prerequisites:**

- Copy `.env.docker.example` to `.env.docker` at repo root and set `POSTGRES_PASSWORD` and `REDIS_PASSWORD`
- For production, create `apps/api/env/.env.production` from `apps/api/env/.env.example`

From the repo root, `pnpm test` runs unit + e2e for all workspaces through
Turborepo, and `pnpm cm` creates a Conventional Commit.
