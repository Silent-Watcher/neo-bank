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
  `registerAs` factories), `logging/` (nestjs-pino), `redis/` (global
  RedisModule: ioredis client provider, `RedisService`,
  `@InjectRedis()`, health indicator), `errors/` +
  `filters/problem-details.filter.ts` (RFC 9457 error contract),
  `interceptors/response-envelope.interceptor.ts` (success envelope),
  `pipes/zod-validation.pipe.ts`, `http/` (request IDs, API version).
- **Infrastructure provider tokens:** use `Symbol` tokens for infrastructure
  providers (e.g. `REDIS_CLIENT`), keep them defined inside the owning
  module's directory, and expose them to consumers only through the owning
  module's exports or a dedicated injection decorator.
- **Request/response contracts:** every successful JSON response is wrapped
  by the envelope interceptor; every error becomes Problem Details
  (ADR-010/011). Do not hand-roll response or error shapes; ADR-011 lists the
  response types that must bypass the envelope.
- **Redis:** global `RedisModule` in `src/shared/redis/` (ADR-012/013) owns
  the single ioredis client and its lifecycle; `RedisService` is the
  application interface. Redis connection settings are mandatory, but the
  server being unreachable degrades health (HTTP 200), never blocks startup
  or crashes the process.

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
- Never use `KEYS`; iterate with `SCAN` (`RedisService.scanKeys`, bounded).
  Delete with `UNLINK`, never `DEL` (requires Redis server ≥ 4.0 — a
  deployment requirement, not a runtime fallback).
- Use atomic Redis operations (e.g. `INCRBY`) when the use case needs them;
  do not add transactions, Lua scripts, or locks without a concrete
  requirement, and never treat pipelining as atomicity.
- Unit tests must not require a running Redis server: use `lazyConnect`
  client instances and provider overrides; e2e tests exercise the degraded
  (unreachable) path against an unroutable URL from `env/.env.test`.

## Directory Structure

```
src/
  main.ts                  # bootstrap only (Fastify, prefix, versioning, CORS)
  modules/
    app/                   # AppModule, health check, Problem Type docs page
    enrollments/           # feature modules: controller + service + schema + specs
  shared/
    config/                # config.ts wiring + env/ Zod schemas + factories
    redis/                 # global RedisModule: provider, RedisService, InjectRedis
    enums/ errors/ filters/ http/ interceptors/ logging/ pipes/
test/
  create-test-app.ts       # e2e app factory mirroring main.ts bootstrap
  *.e2e-spec.ts            # supertest-based e2e suites
  subpath-import-aliases.ts # Vitest resolution of # aliases (keep in sync)
env/                       # .env.development / .env.test / .env.example (gitignored except example)
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
  ad-hoc response shapes.
- Logging only through the injected Pino `Logger` / `PinoLogger`;
  `console.log` is lint-banned.
- New `#` alias → add it in `package.json` `imports` **and**
  `test/subpath-import-aliases.ts`, or Vitest breaks.

## Testing Expectations

- Unit tests (AAA) for schemas, services, controllers; e2e tests via
  `test/create-test-app.ts` for endpoint contracts (envelope, Problem
  Details, routing). Both layers are a project requirement for features
  (root rule).
- e2e specs need `env/.env.test` and run with `--env-file` (wired into the
  `test:e2e` script).
- Do not start dev servers to verify intermediate steps; run the checks when
  the feature is complete (root rule).

## Commands

```sh
pnpm dev          # watch mode (node --env-file + nest start --watch)
pnpm build        # nest build (SWC)
pnpm lint         # oxlint
pnpm format       # oxfmt --write .
pnpm typecheck    # tsc --noEmit
pnpm test         # Vitest unit tests
pnpm test:e2e     # supertest e2e suite
```

## Constraints

- Follow the decision records in [../../DECISIONS.md](../../DECISIONS.md);
  several are still **Pending** but implemented (URI versioning, `api`
  prefix, body limit, Pino, request IDs, envelope) — do not build against
  their rejected alternatives.
- Inspect existing shared infrastructure before adding any abstraction,
  dependency, or pattern — the `shared/` layer already covers config,
  logging, errors, envelopes, and validation.
- When a change matches a Documentation Update Triggers entry in the root
  [AGENTS.md](../../AGENTS.md), update the listed documentation in the same
  task (for the API that is usually this file, `ONBOARDING.md`, and
  `docs/current-state.md`).
- NestJS configuration work has a dedicated skill/convention:
  `agents/skills/nest-config/` (root rule).
