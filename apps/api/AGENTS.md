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
  `@InjectRedis()`, health indicator), `swagger/` (dev-only OpenAPI setup +
  shared response schemas), `errors/` +
  `filters/problem-details.filter.ts` (RFC 9457 error contract),
  `interceptors/response-envelope.interceptor.ts` (success envelope),
  `pipes/zod-validation.pipe.ts`, `http/` (request IDs, API version),
  `throttler/` (global HTTP rate limiting: `@nestjs/throttler` + Redis
  storage, named policies, `RedisThrottlerGuard`).
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
- **Swagger/OpenAPI:** `@nestjs/swagger`, set up by `setupSwagger` in
  `src/shared/swagger/swagger.setup.ts` and gated to `APP_ENV=development`
  in `main.ts` (ADR-014). The UI is at `/docs`, the document at
  `/docs/json`. Request schemas come from Zod via `toJsonSchemaObject`;
  shared response schemas (envelope, Problem Details) live in
  `src/shared/swagger/openapi.schemas.ts`.

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
    redis/                 # global RedisModule: provider, RedisService, InjectRedis,
                           # key builder (redis-keys.ts)
    swagger/               # OpenAPI setup (dev-only), shared response schemas
    throttler/             # global rate limiting: RedisThrottlerStorage, Guard,
                           # module, keys
    enums/ errors/ filters/ http/ interceptors/ logging/ pipes/
test/
  create-test-app.ts       # e2e app factory mirroring main.ts bootstrap
  *.e2e-spec.ts            # supertest-based e2e suites
  *.redis-spec.ts          # real-Redis integration tests (pnpm test:redis)
  subpath-import-aliases.ts # Vitest resolution of # aliases (keep in sync)
env/                       # .env.development / .env.test / .env.example /
                           # .env.redis-test (gitignored except example)
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
pnpm test:redis   # real-Redis rate-limit integration suite (env/.env.redis-test)
```

## Constraints

- Follow the decision records in [../../DECISIONS.md](../../DECISIONS.md) —
  all ADRs ADR-001 through ADR-015 are **Accepted** and implemented; do not
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
