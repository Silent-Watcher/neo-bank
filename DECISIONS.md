# Architecture Decision Records

## ADR-001: Choose Turborepo for Monorepo Management

- **Status:** Accepted
- **Date:** 2026-10-23

### Context

The project consists of three applications maintained by a single developer:

- `apps/api`: NestJS backend.
- `apps/web`: Next.js web application.
- `apps/admin`: React application built with Vite.

The repository needs a unified development workflow, efficient task orchestration, reliable caching, and a structure that allows AI coding agents to understand and work across the entire codebase.

Since the team consists of one developer, minimizing operational overhead and unnecessary complexity is more valuable than adopting an extensive enterprise-oriented toolchain.

### Decision

Use **Turborepo** with pnpm workspaces to manage the monorepo.

The repository will use Turborepo for task orchestration, dependency-aware execution, local and remote caching when needed, and coordination of development, build, lint, test, and type-checking tasks.

Keeping all applications in one repository also allows AI coding agents to access the shared codebase, understand cross-application dependencies, and implement changes across application boundaries without coordinating separate repositories.

### Reasons for Choosing Turborepo

- **Solo development:** A lightweight setup with low maintenance overhead is better suited to a single-developer workflow.
- **AI-assisted development:** A unified repository provides AI coding agents with broader project context, making cross-application changes and shared configuration easier to understand and implement.
- **Task caching:** Turborepo can reuse cached task outputs and avoid unnecessary rebuilds when inputs have not changed.
- **Dependency-aware execution:** Tasks can run in the correct order based on workspace dependencies.
- **Parallel execution:** Independent tasks can run concurrently to improve development efficiency.
- **Incremental scalability:** The repository can introduce additional applications and packages without immediately requiring a more complex orchestration system.
- **Low configuration overhead:** Turborepo provides the orchestration capabilities needed by this project without requiring an extensive framework-specific architecture.

### Alternatives Considered

#### Nx

Nx is a mature monorepo tool with excellent Angular, React, and Node.js support, powerful code generators, and distributed task execution. However, it introduces significant conceptual overhead (projects, libraries, affected graph, computation caching configuration) that exceeds this project's needs. The learning curve and configuration surface area are disproportionate for a three-app repository with a single developer.

#### Yarn Workspaces + Custom Scripts

pnpm workspaces already provide dependency hoisting and isolation. Adding custom scripts for build, test, and lint orchestration would work but lacks Turborepo's intelligent caching, task dependency graph, and parallel execution. Maintaining custom orchestration scripts becomes a maintenance burden as the repository grows.

#### Npm Workspaces

Similar to Yarn workspaces but with slower installation and less mature lockfile management. pnpm is already the chosen package manager (ADR-004 equivalent).

### Consequences

**Positive**

- Fast, cached builds and tests across the monorepo.
- AI coding agents can navigate and modify cross-application code with full context.
- Adding a fourth application or shared package requires only a `package.json` in a new workspace directory.
- Turborepo's remote caching (when enabled) accelerates CI by reusing artifacts across runs.

**Negative**

- Turborepo adds a build dependency and requires a `turbo.json` configuration.
- The team must learn basic Turborepo concepts (pipeline, dependsOn, outputs, cacheDir).

### Implementation Notes

- `turbo.json` defines the pipeline: `build`, `lint`, `typecheck`, `test`, `dev`, `format` with appropriate `dependsOn` and `outputs`.
- `pnpm turbo run <task>` executes tasks in dependency order with caching.
- All three applications and any shared packages are pnpm workspaces under `apps/` and `packages/`.

### References

- [Turborepo Documentation](https://turbo.build/repo/docs)
- pnpm Workspaces: https://pnpm.io/workspaces
- Repository structure: `apps/api`, `apps/web`, `apps/admin`

---

## ADR-002: Adopt Fastify as the NestJS HTTP Platform

- **Status:** Accepted (superseded by ADR-032, 2026-11-15 — the Fastify adapter is replaced by the official Node HTTP adapter; this entry is retained as decision history)
- **Date:** 2026-10-23

### Context

NestJS supports two HTTP platforms: Express (the default) and Fastify. The choice affects performance, ecosystem compatibility, and the types used throughout the application (`FastifyRequest`/`FastifyReply` vs Express `Request`/`Response`).

### Decision

Use **Fastify** as the HTTP platform for the NestJS API.

### Reasons for Choosing Fastify

- **Performance:** Fastify has lower overhead and higher throughput than Express, which matters for a banking API serving concurrent requests.
- **Schema-based validation:** Fastify's native JSON Schema validation integrates cleanly with the project's Zod-based validation layer.
- **Type safety:** Fastify's TypeScript types are first-class and work well with NestJS's dependency injection.
- **Modern architecture:** Fastify is designed for async/await and modern Node.js patterns.

### Alternatives Considered

#### Express

Express is the NestJS default with the largest ecosystem of middleware. However, it has higher overhead, callback-based patterns, and weaker TypeScript integration compared to Fastify. The project does not depend on Express-specific middleware.

### Consequences

- All HTTP-related code must use Fastify types (`FastifyRequest`, `FastifyReply`) and patterns.
- Third-party middleware must be Fastify-compatible or wrapped.
- The global `HttpAdapterHost` and any platform-specific utilities must use the Fastify adapter.

### Implementation Notes

- `main.ts` creates the NestJS app with `NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter())`.
- `bootstrap()` configures Fastify-specific options: `trustProxy`, `bodyLimit`, etc.
- No Express imports or types appear in the codebase.

### References

- [NestJS Fastify Documentation](https://docs.nestjs.com/techniques/performance)
- [Fastify Documentation](https://www.fastify.io/docs/latest/)

---

## ADR-003: Adopt SWC for TypeScript Compilation

- **Status:** Accepted
- **Date:** 2026-10-23

### Context

The project needs a fast TypeScript compiler for development and production builds. Options include `tsc` (built-in), `esbuild`, `swc`, and `vite` (for frontend).

### Decision

Use **SWC** (via `@swc/cli` and `@swc/core`) for the NestJS API compilation.

### Reasons for Choosing SWC

- **Speed:** SWC is significantly faster than `tsc` for both development (watch mode) and production builds.
- **NestJS integration:** `@nestjs/swc` provides first-party integration with NestJS CLI.
- **ESM support:** SWC handles ESM output correctly for the project's `"type": "module"` configuration.
- **Minimal configuration:** A `.swcrc` file with a few options is sufficient.

### Alternatives Considered

#### tsc (TypeScript Compiler)

`tsc` is the reference compiler but is slower, especially in watch mode. It does not provide the compilation speed benefits needed for an efficient development loop.

#### esbuild

esbuild is extremely fast but has limited TypeScript type-checking support (it strips types without full checking). The project uses `pnpm typecheck` (tsc --noEmit) for type checking separately, so esbuild could work for compilation, but SWC's NestJS integration is more mature.

### Consequences

- `pnpm build` uses `nest build` with the SWC compiler.
- `pnpm dev` uses `nest start --watch` with SWC.
- Type checking is a separate `pnpm typecheck` step (`tsc --noEmit`).
- `.swcrc` contains the SWC configuration (module: ESNext, target: ES2022, etc.).

### References

- [SWC Documentation](https://swc.rs/)
- [@nestjs/swc](https://www.npmjs.com/package/@nestjs/swc)

---

## ADR-004: Use @nestjs/config and Zod for Configuration and Environment Validation

- **Status:** Accepted
- **Date:** 2026-10-24

### Context

The application needs a robust configuration system that validates environment variables at startup, provides type-safe access throughout the codebase, and follows the single-source-of-truth principle for environment definitions.

### Decision

Use **@nestjs/config** for configuration management and **Zod** for environment validation schemas.

### Reasons for Choosing This Combination

- **Single source of truth:** Zod schemas in `src/shared/config/env/schema/` define all environment variables with types, defaults, and validation. The `@nestjs/config` `registerAs` factories consume the validated Zod output.
- **Fail-fast startup:** Invalid configuration throws at bootstrap, before the application serves traffic.
- **Type safety:** `ConfigService.getOrThrow<T>()` returns fully typed config objects.
- **No `process.env` in application code:** The only `process.env` access is in the single validation layer (`env.config.ts`), enforced by Oxlint rules.
- **Per-feature config isolation:** Each feature module defines its own Zod schema and config factory (e.g., `enrollments.env.ts`, `enrollments.config.ts`).

### Alternatives Considered

#### @nestjs/config alone (class-validator / manual validation)

`@nestjs/config` supports `validationSchema` with Joi or class-validator, but Zod provides better TypeScript inference, a more ergonomic API, and is already used for request validation.

#### dotenv + manual validation

Reading `process.env` directly throughout the codebase violates the project's security and maintainability rules (lint-enforced `no-process-env`).

### Consequences

- Every new environment variable requires: a Zod schema entry in the feature's schema file, a config factory entry, and updates to `.env.example` + all environment-specific files.
- Configuration is accessed via `ConfigService.getOrThrow<FeatureConfig>(FEATURE_CONFIG)`.
- The `config.ts` wiring file re-exports all feature config symbols for convenience.

### Implementation Notes

- `src/shared/config/env/env.config.ts`: single validation entry point, calls all feature Zod schemas.
- `src/shared/config/config.ts`: barrel file re-exporting all feature config symbols.
- Feature config files: `src/shared/config/env/schema/<feature>.env.ts` + `src/shared/config/<feature>.config.ts`.

### References

- [@nestjs/config Documentation](https://docs.nestjs.com/techniques/configuration)
- [Zod Documentation](https://zod.dev/)

---

## ADR-005: Use URI-Based API Versioning

- **Status:** Accepted
- **Date:** 2026-10-24

### Context

The API needs a versioning strategy to allow backward-compatible evolution. Options include URI path versioning (`/api/v1/...`), header-based versioning, and query parameter versioning.

### Decision

Use **URI path versioning** with a global `/api` prefix and version in the path (e.g., `/api/v1/enrollments/challenge`).

### Reasons for Choosing URI Path Versioning

- **Explicit and discoverable:** Clients see the version in every request URL.
- **Simple routing:** NestJS controllers naturally map to versioned paths via `@Controller('api/v1/enrollments')`.
- **Caching friendly:** CDNs and proxies can cache per-version endpoints naturally.
- **No client complexity:** Clients don't need to manage custom headers.

### Alternatives Considered

#### Header-based versioning (`Accept-Version` or custom header)

More REST-purist but adds client complexity and is harder to debug (version not visible in URLs/logs).

#### Query parameter versioning (`?v=1`)

Least RESTful, easily stripped by proxies, not cache-friendly.

### Consequences

- Global prefix `/api` and version `v1` configured in `main.ts` bootstrap.
- Controllers use `@Controller('v1/enrollments')` (the `/api` prefix is global).
- Future versions add new controller modules (e.g., `v2/`) without modifying v1.

### Implementation Notes

- `app.setGlobalPrefix('api')` in `main.ts`.
- `app.enableVersioning({ type: VersioningType.URI, prefix: 'v', defaultVersion: '1' })`.
- Controllers: `@Controller({ path: 'enrollments', version: '1' })` or `@Controller('v1/enrollments')`.

### References

- [NestJS Versioning Documentation](https://docs.nestjs.com/techniques/versioning)

---

## ADR-006: Configure a Maximum Request Body Size of 1 MiB

- **Status:** Accepted
- **Date:** 2026-10-24

### Context

The Fastify server must enforce a reasonable request body size limit to prevent resource exhaustion from oversized payloads.

### Decision

Set the Fastify `bodyLimit` to **1 MiB** (1,048,576 bytes).

### Reasons

- Sufficient for all current and foreseeable JSON payloads (OTP requests, verification, etc.).
- Prevents memory exhaustion from malicious large payloads.
- Aligns with common API defaults.

### Alternatives Considered

#### Default (unlimited or very high)

Fastify's default is 1 MiB actually; explicitly setting it makes the limit visible and intentional.

#### Lower (e.g., 64 KiB)

Too restrictive for future endpoints that may accept base64-encoded documents or images.

### Consequences

- Requests exceeding 1 MiB receive HTTP 413 Payload Too Large.
- Configured in `main.ts` bootstrap: `bodyLimit: 1048576`.

---

## ADR-007: Use a Global `api` Prefix with a `/health` Exception

- **Status:** Accepted
- **Date:** 2026-10-24

### Context

The API should have a consistent base path for all versioned endpoints while allowing the health check to be accessible at a stable, version-neutral path.

### Decision

- Global prefix: `/api`
- Versioned endpoints under `/api/v1/...`
- Health check at `/health` (no prefix, no version)

### Reasons

- `/health` is a standard infrastructure endpoint used by load balancers, Kubernetes probes, and monitoring.
- Versioning the health check would require clients to know the API version for liveness/readiness probes.

### Consequences

- Configured in `main.ts`: `app.setGlobalPrefix('api', { exclude: ['/health'] })`.
- Health controller at `@Controller('health')` without version.

---

## ADR-008: Choose Pino for Structured Application Logging

- **Status:** Accepted
- **Date:** 2026-10-24

### Context

The application needs a fast, structured JSON logger that integrates with log aggregation systems and supports log levels, redaction, and child loggers.

### Decision

Use **Pino** as the core logging library.

### Reasons

- **Performance:** Pino is one of the fastest Node.js loggers, with minimal overhead.
- **Structured output:** JSON lines are ideal for log aggregation (ELK, Loki, Datadog).
- **Redaction:** Built-in support for redacting sensitive fields (e.g., `req.headers.authorization`).
- **Child loggers:** Hierarchical loggers with bound context (module, request ID).

### Alternatives Considered

#### Winston

Mature but slower and with a more complex API. Pino's performance and simplicity are preferred.

#### Console.log

Not structured, not production-ready, lint-banned in this project.

### Consequences

- All logging uses the injected `PinoLogger` or NestJS `Logger` (backed by nestjs-pino).
- Log level configured via `LOG_LEVEL` env var (default `info`).
- `LOG_LEVEL=debug` enables debug output in development.

---

## ADR-009: Use nestjs-pino for the NestJS Integration

- **Status:** Accepted
- **Date:** 2026-10-24

### Context

NestJS uses its own `LoggerService` abstraction. The application needs Pino integrated as the NestJS logger.

### Decision

Use **nestjs-pino** to bridge Pino with NestJS's logging abstraction.

### Reasons

- Seamless integration: `Logger` injected via `@Inject(PinoLogger)` or standard `Logger` works with Pino backend.
- Request ID correlation via `nestjs-pino`'s `http` context.
- Configuration through NestJS `ConfigModule`.

### Consequences

- `PinoLogger` provided by `nestjs-pino` module in `src/shared/logging/`.
- Application code uses standard NestJS `Logger` (from `@nestjs/common`); output goes to Pino.
- No direct Pino imports in feature modules.

---

## ADR-010: Use UUIDv4 for Request IDs

- **Status:** Accepted
- **Date:** 2026-10-24

### Context

Every HTTP request needs a unique identifier for tracing, debugging, and correlation across logs.

### Decision

Generate **UUIDv4** request IDs for every incoming request.

### Reasons

- Globally unique without coordination.
- Standard format, widely recognized in observability tools.
- Low collision probability for the project's scale.

### Alternatives Considered

#### ULID / KSUID

Sortable and include timestamp, but larger and less universally recognized than UUIDv4.

#### Incrementing integer

Requires coordination, not suitable for distributed systems.

### Consequences

- Request ID generated in `src/shared/http/request-id.middleware.ts` (or interceptor).
- Added to response headers as `X-Request-ID`.
- Included in all log lines via Pino child logger.
- Included in Problem Details error responses.

---

## ADR-011: Exclude Special Response Types from the Standard Success Envelope

- **Status:** Accepted
- **Date:** 2026-10-24

### Context

The application wraps all successful JSON responses in a standard envelope: `{ data, meta, apiVersion }`. Some responses (file downloads, streaming, redirects) must bypass this envelope.

### Decision

The following response types bypass the success envelope interceptor:

1. **File downloads** (`Content-Disposition: attachment`)
2. **Streaming responses** (Server-Sent Events, WebSockets)
3. **Redirects** (3xx status codes)
4. **Problem Details errors** (already handled by the global filter, never reach the envelope interceptor)

### Consequences

- `ResponseEnvelopeInterceptor` checks response headers/status before wrapping.
- Documented in `src/shared/interceptors/response-envelope.interceptor.ts`.

---

## ADR-012: Use ioredis Directly Without a Third-Party NestJS Redis Wrapper

- **Status:** Accepted
- **Date:** 2026-10-25

### Context

The application needs a Redis client for OTP storage, rate limiting, and future features. Options include raw `ioredis`, `@nestjs-modules/ioredis`, or a custom wrapper.

### Decision

Use **raw ioredis** directly, wrapped in a project-owned `RedisModule` with a `RedisService` abstraction.

### Reasons

- **No wrapper overhead:** Third-party wrappers add indirection, version lock-in, and often lag behind ioredis updates.
- **Full control:** The project owns the connection lifecycle, error handling, and method surface area.
- **Minimal surface:** `RedisService` exposes only what the application needs (get, set, setNxEx, deleteIfEquals, verifyOtpAndCountAttempts, checkOtpRateLimit, scanKeys, increment, etc.), not the full ioredis API.
- **Single connection:** One ioredis client shared via `RedisModule`, lifecycle managed by `RedisService` (`OnModuleInit`, `OnApplicationShutdown`).

### Alternatives Considered

#### @nestjs-modules/ioredis

Popular wrapper but adds a dependency, abstracts the client in ways that can conflict with custom Lua scripts and connection settings, and the project would still need a `RedisService` for application-level methods.

#### Custom wrapper around ioredis without NestJS module

Would lack NestJS lifecycle integration and DI.

### Consequences

- `src/shared/redis/redis.module.ts` provides the ioredis client as `REDIS_CLIENT` token.
- `RedisService` is the application interface, injectable everywhere.
- Direct client access via `@InjectRedis()` is an escape hatch for exceptional cases only.
- Lua scripts are defined as constants in `redis.service.ts` and executed via `client.eval()`.

---

## ADR-013: Global Redis Module with an Application-Level Abstraction

- **Status:** Accepted
- **Date:** 2026-10-25

### Context

The Redis client and its lifecycle must be managed centrally, with a clean application-level interface for feature modules.

### Decision

Create a **global `RedisModule`** in `src/shared/redis/` that:

- Provides a single ioredis client (`REDIS_CLIENT` token)
- Exposes `RedisService` with application-specific methods
- Manages connection lifecycle (`OnModuleInit`, `OnApplicationShutdown`)
- Provides `buildRedisKey()` for centralized key naming
- Reports health via a Terminus health indicator

### Consequences

- Feature modules import `RedisModule` and inject `RedisService`.
- No feature module creates its own Redis connection or imports ioredis directly.
- Key naming follows `<app>:<module>:<feature>:<resource>:<identifier>` via `buildRedisKey()`.
- Lua scripts are co-located in `RedisService` as constants.

---

## ADR-014: Use Swagger/OpenAPI with Development-Only Availability

- **Status:** Accepted
- **Date:** 2026-10-26

### Context

The API needs interactive documentation for development and consumer integration, but must not expose it in test or production.

### Decision

Use **@nestjs/swagger** with the following constraints:

- Swagger UI at `/docs`, document at `/docs/json` and `/docs/yaml`.
- Only enabled when `APP_ENV=development`.
- Request schemas derived from Zod via `toJsonSchemaObject()`.
- Shared response schemas (envelope, Problem Details) in `src/shared/swagger/openapi.schemas.ts`.
- Every endpoint must have Swagger decorators; undocumented endpoints are incomplete.

### Consequences

- `src/shared/swagger/swagger.setup.ts` configures Swagger.
- `main.ts` calls `setupSwagger(app)` only when `APP_ENV === 'development'`.
- E2E tests verify Swagger document completeness (`test/swagger.e2e-spec.ts`).

---

## ADR-015: Global HTTP Rate Limiting with Redis-Backed @nestjs/throttler

- **Status:** Accepted
- **Date:** 2026-10-26

### Context

The API needs rate limiting to prevent abuse. Options include in-memory, Redis-backed, or external (API gateway).

### Decision

Use **@nestjs/throttler** with a **custom Redis-backed storage** (`RedisThrottlerStorage`) for global rate limiting, with named policies (`short`, `long`) and endpoint-specific overrides via `@Throttle()`.

### Reasons

- **Redis-backed:** Works across multiple instances in production; survives restarts.
- **Named policies:** Global defaults (`short`: 10 req/1s, `long`: 100 req/1m) with per-endpoint overrides.
- **Atomic Lua script:** The custom storage uses a Lua script for atomic check-and-increment.
- **NestJS integration:** Guards, decorators, and module work natively.

### Consequences

- `src/shared/throttler/` contains the storage, guard, and module.
- `RATE_LIMIT_CONFIG` symbol configures default limits via env vars.
- Enrollments endpoints use `@Throttle({ short: { limit: 2, ttl: seconds(120) } })` for challenge and `{ short: { limit: 5, ttl: seconds(120) } }` for verify.

---

## ADR-016: Adopt Testcontainers for Integration and E2E Testing

- **Status:** Accepted
- **Date:** 2026-10-27

### Context

Integration and E2E tests require real Redis (for atomic Lua scripts, TTL, connection lifecycle) and future PostgreSQL. The project previously relied on a shared Docker Compose stack (`compose.dev.yml`) which caused test isolation issues.

### Decision

Use **Testcontainers** (Node.js) to start isolated Redis/PostgreSQL containers per test file or worker, with dynamic ports.

### Consequences

- `apps/api/test/testcontainers.ts` provides `TestRedis` class.
- `pnpm test:redis` and `pnpm test:e2e` use real containers.
- Unit tests (`pnpm test`) continue mocking `RedisService` — no Docker required.
- Image versions pinned in code (`redis:8.2-alpine`).

---

## ADR-017: OTP Verification Attempt Lockout for Enrollment Security

- **Status:** Accepted
- **Date:** 2026-11-08

### Context

The enrollment module implements OTP-based phone verification. The existing implementation:

- Generates a 6-digit OTP (900,000 possibilities) and stores it in Redis with a 120s TTL using `SET NX EX`.
- Tracks failed verification attempts in a separate Redis key (`attempts:<phone>`) with a 120s TTL (matching the OTP window).
- Atomically verifies and counts attempts via a Lua script: on success, both keys are deleted; on failure, attempts are incremented and the OTP is invalidated when attempts reach the configured maximum (default 5).
- Has a per-phone hourly rate limit (5 sends/hour) on the challenge endpoint via a sorted-set Lua script.
- Has per-IP throttling via `@nestjs/throttler` (challenge: 2/120s, verify: 5/120s).

**Vulnerability discovered:** The attempt limit is bypassable by requesting a new OTP after the previous one is invalidated:

1. Attacker requests OTP → OTP stored, no attempts key yet.
2. Attacker submits 5 wrong OTPs → attempts=5, OTP key UNLINKed (max reached).
3. Attacker requests new OTP → SET NX EX succeeds (old OTP key gone), new OTP stored, attempts=5 persists (TTL ~115s).
4. Attacker submits wrong OTP → attempts=6 ≥ 5 → new OTP immediately UNLINKed (1 guess per new OTP).
5. Rate limit allows 5 sends/hour → 9 total guesses/hour (5 initial + 4×1).
6. If the attempts key expires (120s from first failure) before the next OTP request, the counter resets → 5 fresh attempts per OTP → 25 guesses/hour.
7. **Critical:** The verify script's SUCCESS path does NOT check the attempts counter. A correct guess on a newly-issued OTP after max attempts still succeeds — the lockout only blocks wrong guesses.

Additionally, the 120s cooldown (enforced by `SET NX EX` on the OTP key) is bypassed when the OTP is invalidated by the attempt limit, because the key is deleted.

The rate limit and attempt limit enforce different boundaries: rate limit restricts OTP _issuance_ (5/hour), attempt limit restricts _verification guesses_ per OTP (5). They are not integrated, allowing the bypass.

### Decision

Introduce a **lockout mechanism** that prevents both OTP issuance and verification after the maximum failed attempts is reached, with a configurable lockout window independent of the OTP TTL.

**Changes:**

1. **New Redis key:** `neo-bank:enrollments:challenge:lockout:<phone>` — set atomically when attempts >= maxAttempts, TTL = `lockoutTtlSeconds` (configurable, default 900s = 15 min).

2. **Extended attempts key TTL:** The `attempts` key TTL becomes `lockoutTtlSeconds` (not OTP TTL), so the failure counter persists across OTP regeneration within the lockout window.

3. **Verify Lua script updated:**
   - First check: if lockout key exists → return 0 (reject) WITHOUT incrementing attempts (prevents lockout extension via verification spam).
   - On correct OTP: delete OTP key, attempts key, AND lockout key (defense-in-depth; success implies lockout shouldn't exist but clear it anyway).
   - On failure: increment attempts; if attempts >= maxAttempts → SET lockout key with TTL, UNLINK OTP key.

4. **Send (challenge) Lua script created:** New atomic `ISSUE_OTP_SCRIPT` combining:
   - Lockout key check → return `3` (locked) if present.
   - `SET NX EX` for OTP key → return `1` (created) or `0` (active OTP exists).
   - This replaces the two-call sequence (`checkOtpRateLimit` + `setNxEx`) for the security-critical path. The hourly rate limit remains a separate preceding check (it's a quota, not a security lock).

5. **Configuration:** Add `ENROLLMENTS_LOCKOUT_TTL_SECONDS` env var (default 900 = 15 min) and `ENROLLMENTS_MAX_VERIFY_ATTEMPTS` (existing, default 5).

6. **Error responses:** Both locked send and locked verify return the same generic `OTP_RATE_LIMIT_EXCEEDED` / `OTP_VERIFICATION_FAILED` messages as existing rate-limit/verification failures, so attackers cannot distinguish lockout from other limits.

### Reasons for Selecting This Approach

- **Atomicity:** Lockout is set and checked within the same Lua scripts that modify the OTP/attempts state — no race window.
- **Independent semantics:** Lockout TTL (security window) is independent of OTP TTL (issuance window). The attempts counter aligns with lockout, not OTP.
- **Defense-in-depth:** Success path clears lockout; lockout check in verify doesn't increment counter (prevents DoS extension).
- **Minimal API change:** Reuses existing error codes and generic messages; clients see no new error types.
- **Rate limit preserved:** The hourly per-phone quota (5/hour) remains as a complementary spam control.

### Alternatives Considered

#### 1. Only extend attempts key TTL (no lockout key)

Extend attempts TTL to e.g. 15 min. After max attempts, the attempts counter is ≥ max, so any new verify immediately fails (attempts ≥ max → UNLINK OTP). This gives 1 guess per new OTP, not 5. But:

- The success path still doesn't check attempts → correct guess after max attempts succeeds.
- No way to distinguish "locked" from "rate limited" in send path without a lockout key.
- Less explicit semantics; harder to reason about.

#### 2. Only add lockout check in verify (not in send)

Verify would reject during lockout, but send could still issue new OTPs (wasting rate-limit quota, creating unverifiable OTPs). The race between send's rate-limit check + SET NX EX and verify's lockout set is small but non-zero.

#### 3. Make lockout TTL = OTP TTL (120s)

Defeats the purpose — the lockout would expire with the OTP, allowing immediate re-attempt. The lockout must exceed the OTP window to be effective.

#### 4. IP-based lockout instead of per-phone

The existing per-IP throttler handles IP-level abuse. A per-phone lockout is necessary because the attacker targets a specific victim's phone number, potentially from many IPs (distributed attack).

#### 5. Progressive backoff (increasing lockout duration)

More complex; not justified for the current threat model. A fixed configurable window is simpler and auditable.

### Consequences

**Positive**

- Maximum incorrect OTP attempts is now a hard boundary that cannot be bypassed by requesting new OTPs.
- Attackers get exactly `maxVerifyAttempts` (default 5) guesses per lockout window (default 15 min), regardless of OTP regeneration.
- The per-phone rate limit (5/hour) and lockout (5 per 15 min) are complementary: rate limit prevents spam issuance, lockout prevents verification brute force.
- Atomic Lua scripts ensure no race conditions between concurrent send/verify operations.
- Generic error responses maintain indistinguishability of failure modes.

**Negative**

- Legitimate user who fails 5 times must wait the lockout window (15 min) before trying again. This is a UX trade-off for security; the window is configurable.
- A DoS attacker could intentionally trigger lockouts for known phone numbers. However, the lockout is per-phone and requires 5 failed verifications (which the attacker must initiate). The rate limit (5 sends/hour) and per-IP throttle (2/120s) make mass lockout triggering costly.
- Additional Redis key per phone during lockout (negligible memory).

### Implementation Notes

- **New key function** in `enrollments.keys.ts`: `challengeLockoutKey(phoneNumber)`.
- **New env var** in `enrollments.env.ts`: `ENROLLMENTS_LOCKOUT_TTL_SECONDS` (default 900).
- **Updated Lua scripts** in `redis.service.ts`:
  - `VERIFY_OTP_ATTEMPTS_SCRIPT` → add lockout check at start, set lockout on max attempts, clear lockout on success.
  - New `ISSUE_OTP_SCRIPT` for atomic lockout check + SET NX EX.
- **Updated `RedisService` methods**: `verifyOtpAndCountAttempts`, new `issueOtp` (or similar), `checkOtpRateLimit` remains for hourly quota.
- **Updated `EnrollmentsService`**: use new `issueOtp` method (lockout check + SET NX EX), pass lockout TTL to verify.
- **Configuration**: add lockout TTL to `EnrollmentsConfig`.
- **Tests**: add redis-spec and e2e tests for lockout behavior (bypass attempts, concurrent send/verify, lockout expiry, success clears lockout).

### Attack Probability Assessment (Quantitative)

**Parameters:**

- OTP space: 900,000 (6 digits, 100000–999999)
- Max attempts per lockout window: 5
- Lockout window: 900s (15 min)
- Rate limit: 5 OTP sends/hour per phone
- Per-IP verify throttle: 5/120s (not the binding constraint for distributed attacks)

**Single lockout window (15 min):**

- Attacker gets exactly 5 guesses (maxAttempts) before lockout.
- Probability of success in one window: `P = 1 - (1 - 1/900000)^5 ≈ 5.56e-6` (0.000556%)

**Per hour (4 lockout windows × 5 attempts = 20 guesses max, but rate limit caps at 5 OTPs/hour = 5 windows max if spaced):**

- Effective: 5 guesses per hour (rate limit 5 sends, each send allows up to 5 attempts but lockout stops after first 5).
- Actually: first OTP gives 5 attempts → lockout. Subsequent sends during lockout are rejected. After lockout expires (15 min), attacker can send 1 OTP (if rate limit allows), get 5 attempts, lockout again. In 60 min: 60/15 = 4 lockout cycles → 4 × 5 = 20 attempts, but rate limit 5/hour caps at 5 OTPs = 5 × 5 = 25 attempts IF lockout expires before rate limit window ends... wait, rate limit is rolling 60 min. With lockout 15 min, the attacker can at most get 5 OTPs/hour. Each OTP before lockout gives 5 attempts? No — after first OTP's 5 attempts, lockout triggers. Next OTP request during lockout is rejected by lockout check. So only 1 OTP per lockout window = 5 attempts per 15 min = 20 attempts/hour max, but rate limit 5/hour means at most 5 OTPs = 25 attempts if lockout didn't block sends. With lockout blocking sends, it's 4 windows × 5 = 20 attempts/hour. But the lockout prevents the send, so rate limit isn't the binding constraint — the lockout is.

**Worst-case per hour (lockout blocks sends, 4 lockout cycles/hour):**

- 4 × 5 = 20 guesses/hour
- `P = 1 - (1 - 1/900000)^20 ≈ 2.22e-5` (0.00222%)

**Comparison to pre-fix (no lockout, 25 guesses/hour max):**

- Pre-fix: `P = 1 - (1 - 1/900000)^25 ≈ 2.78e-5` (0.00278%)
- Fix reduces hourly success probability by ~20% and more importantly makes the bound **predictable and non-bypassable** (exactly maxAttempts per lockout window, not per OTP).

**Assumptions:**

- OTP is uniformly random (cryptographically secure `randomInt`).
- Attacker cannot observe OTP values (no SMS delivery yet).
- Attacker cannot bypass rate limits (5 sends/hour per phone, 2/120s per IP).
- Lockout TTL is exactly enforced (Redis TTL accuracy ±1s).
- Distributed attack from many IPs: per-IP throttle not binding; per-phone rate limit and lockout are the only constraints.

### References

- OWASP Authentication Cheat Sheet: Brute Force Protection
- NIST SP 800-63B: Authentication and Lifecycle Management
- ADR-013 (Redis module), ADR-015 (Rate limiting), ADR-016 (Testcontainers)
- `prompts/_023-production-ready-otp-enrollment-flow.md`, `prompts/_025-otp-slow-harassment-prevention.md`

---

## ADR-018: HMAC-SHA-256 Digest Storage for Enrollment OTPs

- **Status:** Accepted
- **Date:** 2026-11-10

### Context

The enrollment OTP flow stores OTP values in Redis as plaintext under `neo-bank:enrollments:challenge:otp:<phone>` with a 120s TTL. A Redis read-only compromise (unencrypted snapshot or backup leak, replication tap, accidental exposure via `GET`/logging tooling) therefore exposes every active OTP as a directly usable credential.

The OTP itself has only ~19.8 bits of entropy (`log2(900000)` for six digits in 100000–999999). Any storage form that lets an attacker _verify a candidate offline_ — plaintext, plain SHA-256, or salted SHA-256 — allows exhaustive enumeration of the space once the stored value is in hand. The existing defenses (5 attempts per 900s lockout window, 5 sends/phone/hour, per-IP throttles) constrain only _online_ guessing; they do not apply to an attacker working offline from leaked Redis data. This item was tracked as mandatory deferred work (`DEFERRED.md`, item 1).

### Decision

Replace plaintext OTP storage with keyed digests, keeping the Redis key structure, TTLs, rate limits, lockout semantics, and HTTP contracts unchanged:

1. **New required env var `ENROLLMENTS_OTP_HMAC_SECRET`** — a dedicated cryptographic secret, validated by the Zod environment layer at startup: exactly 64 hexadecimal characters, i.e. 32 decoded bytes (`openssl rand -hex 32`). No default, no fallback, never logged, never stored in Redis, must be identical across all API instances, and must not be reused from other credentials (JWT/session secrets). It is decoded to its 32 key bytes before use — the encoded string length is never mistaken for the key length.

2. **Digest generation in Node.js:** the stored value is `HMAC-SHA-256(key, "<phone>:<otp>")` using `node:crypto` `createHmac`. The phone number is bound into the HMAC input: it is validated digits-only by the request schema, so `:` is an unambiguous separator, and binding it prevents digest substitution between challenges (an attacker with Redis _write_ access cannot copy the digest of an OTP they legitimately received for their own phone onto a victim's phone key).

3. **Issuance:** `requestChallenge` computes the digest and passes it to the existing atomic `ISSUE_OTP_SCRIPT` (lockout check + `SET NX EX`). The script performs no comparison; only the stored value changes from six digits to 64 hex characters. Key, TTL, and NX semantics are untouched.

4. **Verification — comparison entirely in Node.js with `crypto.timingSafeEqual`:**
   - Read the stored value with a plain `GET`.
   - Compute the HMAC digest of the submitted OTP and compare it against the stored digest over equal-length 32-byte buffers. A missing or malformed stored value (wrong length, non-hex) results in a failed verification — never an exception, never a fallback comparison of raw values. No plaintext `===`/`==` comparison exists anywhere.
   - Atomically resolve through a Lua script that performs **no digest comparison**: it receives the Node-side `matched` result and either (a) rejects because the lockout key exists (without counting an attempt), (b) consumes — `UNLINK` of otp/attempts/lockout — when matched and the OTP key still exists, or (c) counts the failed attempt (`INCR` + lockout set at max).

   **Why the Lua script does no digest comparison (deliberate deviation from "compare inside the atomic script"):** ordinary Lua string equality is not a timing-safe comparison, and the project forbids hand-rolling constant-time comparison inside Redis. The comparison therefore happens in Node with `crypto.timingSafeEqual`. The match decision is computed against a `GET` snapshot, and the resolve script re-checks both the lockout key and the OTP key's existence authoritatively at resolve time, so the attempt limit remains non-bypassable: any resolve executed after the lockout is set is rejected, exactly as in the fully-atomic variant. `WATCH/MULTI/EXEC` is not required because the resolve script alone provides the necessary atomicity.

   **Documented residual window (stale match after rotation):** between the `GET` and the resolve, the OTP key can expire and — since `SET NX` only guards an existing key — a new challenge can re-create it with a _different_ digest. In that sub-millisecond window, a `matched` decision (which always required a genuinely valid OTP for that phone) consumes the newly issued OTP without it being verified. This is not an authentication bypass — knowledge of a valid OTP for the same phone is still required, and phone binding prevents cross-phone substitution — and the old fully-atomic comparison would instead have counted the attempt. **Superseded by ADR-019:** consumption is now bound to a per-issuance challenge ID verified atomically at resolve time, closing this window; this paragraph is retained as decision history.

   **Documented micro-difference:** none — enforced semantics are identical to the previous fully-atomic script. The resolve script implements the same three outcomes (lockout present → reject without counting; matched and the OTP key still exists → consume; anything else → count the attempt), so a matched decision whose OTP key disappeared between the `GET` and the resolve falls through to attempt counting exactly as the old script counted a verify against a missing key. The comparison is merely computed against a snapshot instead of inside the script; every state transition remains atomic.

5. **No migration, no plaintext fallback:** OTPs issued before deployment fail verification under the new mechanism and expire naturally within ≤120s; users re-request a code. Verification of a plaintext value against a digest can never succeed, so no compatibility path is offered.

### Alternatives Considered

- **Plaintext storage (status quo):** simplest and directly verifiable, but a Redis read-only leak exposes usable OTPs. Rejected — this is the problem being solved.
- **Plain SHA-256:** one-way, but with only ~19.8 bits of search space, an attacker holding the digest enumerates all 900,000 candidates in seconds on commodity hardware. Rejected.
- **Salted SHA-256:** defeats precomputation, but the salt sits next to the digest in Redis; exhaustive enumeration of the small space per-salt remains trivial. Rejected.
- **HMAC-SHA-256 (selected):** keyed verification — without the independently protected secret, stored digests cannot be matched against candidate OTPs at all. No new dependency (`node:crypto`), microseconds per verify.
- **Encryption (e.g. AES-GCM):** reversible; requires key management _and_ decryption on every inspection, while verification only needs a digest comparison. Provides no benefit over HMAC here and keeps usable ciphertext in Redis. Rejected.
- **Argon2id/bcrypt:** password hashing is the wrong tool class: designed for human-memorable low-entropy passwords without rate limiting, costing tens to hundreds of milliseconds per verification on a hot endpoint, while the actual enforcement of bounded guessing already comes from the attempt limit and lockout. HMAC achieves the keyed-verification goal at negligible cost. Rejected.
- **Comparison inside the atomic Lua script (digest-vs-digest):** preserves single-round-trip atomicity, but relies on Lua string equality — a timing-sensitive comparison of secret-derived values, which the decision explicitly excludes. The two-phase Node-compare + atomic resolve achieves equivalent enforced semantics.

### Consequences

**Positive**

- Redis read-only compromise no longer yields usable OTPs: digests without the HMAC secret cannot be matched against candidate codes offline.
- Digest substitution between phone numbers is blocked by phone binding.
- Digest comparison is timing-safe (`crypto.timingSafeEqual` over fixed-length buffers).
- OTP lifecycle, Redis keys, TTLs, rate limits, lockout semantics, and HTTP contracts are unchanged; no new dependencies.

**Negative / limitations (stated plainly)**

- HMAC does **not** increase OTP entropy. If an attacker obtains _both_ Redis data and the HMAC secret, offline brute-force of a single digest is limited only by the ~19.8-bit OTP space — computationally trivial. The scheme's security therefore rests on the secret being protected independently of Redis.
- Online guessing resistance is **unchanged**: it continues to depend on the attempt limit, lockout, rate limits, and TTL, none of which this decision modifies.
- Redis _write_ access is not mitigated beyond phone binding: an attacker who can write can delete OTPs or attempt to poison state as before.
- `timingSafeEqual` protects the byte comparison only, not every conceivable timing side channel of the endpoint.
- Rotating the secret invalidates all pending digests instantly (at most 120s of in-flight codes fail); operators must deploy rotation with that expectation.

### Operational Implications

- **Provisioning:** the secret is generated once per environment (`openssl rand -hex 32`) and provided through the existing env-file workflow (`ENROLLMENTS_OTP_HMAC_SECRET`); startup fails fast when it is missing, malformed, or not 32 decoded bytes.
- **Consistency:** all API instances verifying the same OTPs must share the identical secret — same requirement class as any shared signing credential.
- **Rotation:** restart all instances with the new value; pending OTPs issued under the old key fail verification and users re-request. No automatic dual-key window is provided (YAGNI for a 120s validity window).
- **Migration:** none; no dual-read of plaintext.

### References

- `docs/security-otp-enrollment.md` (threat model, updated alongside this ADR)
- ADR-013 (Redis module), ADR-017 (OTP verification attempt lockout)
- `apps/api/src/modules/enrollments/` (digest module, service), `apps/api/src/shared/redis/redis.service.ts` (resolve script)
- `DEFERRED.md` item 1 (resolved by this ADR; approach adapted from the suggested Argon2id to HMAC-SHA-256, see Alternatives)

---

## ADR-019: OTP Verification Hardening — Conditional Attempt Counting and Challenge Identity

- **Status:** Accepted
- **Date:** 2026-11-10

### Context

Two findings from the judge review of ADR-018 (tracked with full investigation results in `docs/judge-findings.md`, F1/F2):

1. **Lockout without a challenge (F1, Medium):** the resolve script counts attempts whenever the OTP key is missing — expired, consumed, or never issued. Because `ISSUE_OTP_SCRIPT` refuses issuance while a lockout exists, an unauthenticated attacker can lock any phone out of issuance entirely with garbage verify requests, without the victim ever requesting a challenge. The per-IP throttle (5 req/120 s) bounds single-source abuse but not distributed per-phone abuse. This behavior predates ADR-018 (ADR-017's script had the same fall-through) and was a documented trade-off; this ADR now resolves it.

2. **Stale match consumes a replaced challenge (F2, Low):** ADR-018's verification compares the digest against a `GET` snapshot in Node and the resolve script consumes on `matched && EXISTS otpKey`. In the sub-millisecond gap the key can expire and be re-issued with a different digest, so a matched decision consumes a challenge that was never verified. No authentication bypass (a genuinely valid OTP for the same phone is still required), but consumption and verification can diverge.

### Decision

**F1 — attempt counting is conditional on a live challenge.** The resolve script increments `attemptsKey` (and can set the lockout) only when `EXISTS otpKey == 1`. Verification against a missing, expired, or consumed challenge is rejected without touching any state. Consequences, verified against the full lifecycle:

- Every path that can create `lockoutKey` now requires a live challenge, so the no-challenge lockout DoS is impossible. Triggering a lockout now costs the attacker a real issuance (per-phone 5 sends/hour) plus max wrong guesses against that live challenge — the bounded §2.5 scenario.
- Brute-force protection is unchanged: guesses only matter against a stored OTP, attempts still count while it is live, the OTP cannot be extended (`SET NX`, fixed 120 s TTL), and the attempts counter persists across challenge replacement within the lockout window (ADR-017).
- No new enumeration or error surface: the resolve still returns a single boolean and every failure remains one generic response.

**F2 — challenge identity binds consumption to the verified snapshot.** Every issuance generates a `crypto.randomUUID()` challenge ID and stores `<challengeId>:<digest>` under the existing key. Verification parses the stored value; the digest comparison stays in Node with `crypto.timingSafeEqual`; the observed challenge ID is passed to the resolve script, which consumes the challenge only when the currently stored value's ID prefix still equals the observed one. A replaced challenge (ID mismatch) falls to the attempt branch instead of being consumed.

The challenge ID is a random identifier, not secret-derived material; comparing it inside Lua does not reintroduce the timing-sensitive comparison of secret digests that ADR-018 excluded. `crypto.timingSafeEqual` remains the only comparison of secret-derived values. The ID is internal — it is never returned to, or accepted from, clients, so the API contract is unchanged and the API-level `challengeId` deferral (`DEFERRED.md` item 2) remains deferred.

### Alternatives Considered

**F1:**

- _Gate on OTP existence (selected):_ script-only change; removes every lockout-without-challenge path while keeping enforced attempt semantics identical for live challenges.
- _Gate + independent per-phone verify rate limiter (new sorted-set key and script):_ rejected as YAGNI — after gating, stateless garbage verifies have no security effect and no state cost; the global throttler bounds volume. Revisit if abuse patterns appear.
- _Separate verification lock from issuance lock (two lockout keys):_ rejected — a larger redesign of ADR-017's semantics without additional protection.

**F2:**

- _Challenge ID + atomic compare-and-consume (selected):_ one script, one round trip, no new concurrency pattern; consumption is provably bound to the verified snapshot.
- _`WATCH`/`MULTI`/`EXEC` optimistic transactions:_ equivalent guarantees but the match decision happens outside the transaction, all three keys must be watched, a bounded retry loop is required, and transactions are a pattern that does not exist in this codebase — more machinery for the same outcome. Rejected.
- _Script returns the current value for Node re-comparison:_ re-creates the fetch-then-compare race or pushes the digest comparison into Lua. Rejected.

### Consequences

**Positive**

- A phone can no longer be locked out of issuance without a live challenge; the remaining lockout path requires a real issuance.
- Consumption and verification are snapshot-consistent: an expired or replaced challenge is never consumed through a stale match; the previous residual window (documented in ADR-018) is closed.
- Enforced attempt semantics for live challenges are unchanged; all Lua state transitions remain single-script atomic.

**Negative**

- Verification against an expired OTP no longer counts an attempt (previously counted). This is the intended behavior: attempts exist to bound guessing of a _live_ code.
- The stored value grows from 64 to 101 characters (UUID + separator + digest); a UUIDv4 is generated per issuance.
- Parsing adds one strict-format step; a malformed stored value is fail-closed (failed verification, no consumption, no exception), same as ADR-018's malformed-digest handling.

### References

- `docs/judge-findings.md` (F1/F2 investigation record), ADR-017, ADR-018
- `apps/api/src/modules/enrollments/enrollments.otp-digest.ts` (challenge value compose/parse), `apps/api/src/shared/redis/redis.service.ts` (resolve script)
- `docs/security-otp-enrollment.md` (threat model, updated alongside)

---

## ADR-020: Migrate the Development Redis Service to Redis Stack with Bundled Redis Insight

- **Status:** Accepted
- **Date:** 2026-11-10

### Context

The Docker development stack (`compose.dev.yml`) runs a standalone `redis:8.2-alpine` server. Developing and debugging the enrollment OTP flow, the rate-limiting Lua scripts, and future Redis-backed features requires inspecting live keys, TTLs, and script behavior. Redis Insight is the official GUI for this, but running it as a separately managed Compose service would add another image, port mapping, healthcheck, and connection configuration — extra infrastructure for a developer-only tool.

Redis Stack bundles the Redis server, the Redis Stack modules, and Redis Insight in a single image (`redis/redis-stack`): Redis serves on port 6379 exactly as before, and Redis Insight listens on port 8001 inside the same container. Swapping the image makes Insight available automatically whenever the local stack starts, with no additional service to manage.

### Decision

- **Development stack only:** the `compose.dev.yml` `redis` service uses `redis/redis-stack:latest`. The standalone Redis connectivity contract is preserved unchanged: same service name (`redis`), same internal port (6379), same authentication (`--requirepass` via the image's `REDIS_ARGS`), same ephemeral persistence settings (`--save '' --appendonly no`), same healthcheck mechanism, same networks and dependency wiring.
- **Redis Insight is exposed only in development** through the host mapping `${REDIS_INSIGHT_PORT:-8001}:8001` and is reachable at `http://localhost:8001`. The production stack (`compose.prod.yml`) keeps the version-pinned standalone `redis:8.2-alpine` image and exposes no Redis ports; production gains nothing from a developer GUI and does not carry an unpinned `latest` image.
- **The API logs the Redis Insight URL at startup** — `Redis Insight: http://localhost:8001` — through the existing Pino startup logging (`main.ts` / `startup-url.ts`). The URL comes from a new optional `REDIS_INSIGHT_URL` environment variable, set only by the development Compose stack. When the variable is unset (local non-Docker development, production), the line is not logged, so the API never advertises an address it cannot know exists.

### Alternatives Considered

- _Keep the standalone Redis server without Redis Insight:_ no infrastructure change, but developers keep inspecting Redis through raw `redis-cli` commands; rejected as a worse development experience for zero cost saving.
- _Keep Redis Server and run Redis Insight as a separate Compose service:_ decouples the images and keeps the server minimal, but adds a second container to configure, expose, healthcheck, and wire to the same network — exactly the separately managed service this migration avoids. Rejected.
- _Use the Redis Stack image with bundled Redis Insight (selected):_ one image, one container, one port mapping; Insight appears automatically with the dev stack. Cost: the image is larger and carries modules the application does not use yet.

### Consequences and Trade-offs

**Positive**

- Redis Insight is available without managing a separate service; it starts with the stack it inspects.
- Developers discover the Insight URL directly from the API startup log.
- The dev server gains Redis Stack capabilities (JSON, search, time series, bloom filters) should a future feature need them.

**Negative**

- `redis/redis-stack:latest` is unpinned, diverging from the repo's version-pinned image convention; the trade-off is accepted for the developer tooling image only. Revisit pinning when a Stack version is chosen for production use.
- The dev container consumes more memory than the standalone server (bundled modules + the Insight web UI).
- The Insight interface must stay restricted to the local development environment; it must never be exposed in production or on public networks. The production stack's Redis remains isolated on the internal network.

### References

- `docker/compose.app.dev.yml` (redis service), `docker/env/.env.docker.example` (REDIS_INSIGHT_PORT), `apps/api/src/shared/http/startup-url.ts` and `apps/api/src/main.ts` (startup logging), `apps/api/src/shared/config/env/schema/server.env.ts` (optional REDIS_INSIGHT_URL)
- `docs/docker.md` (ports table, Insight access)

---

## ADR-021: Bilingual Internationalization (en/fa) via the Official @nestjs/i18n

- **Status:** Accepted
- **Date:** 2026-11-10

### Context

The API is English-only. Every user-facing message — the success envelope's `message`, Problem Details `title`/`detail`, OTP service error details, and Zod validation messages — is a hardcoded English string constant. The application must support English (`en`) and Persian (`fa`), resolved per request from `Accept-Language` only, without changing any API contract. Clients already rely on machine-readable fields (`code`, `status`, `type`, envelope shape) as the stable contract; human-readable fields (`title`, `detail`, `message`) are documented as non-contractual.

The existing architecture has three message-producing paths: the `ResponseEnvelopeInterceptor` (success `message`), the `ProblemDetailsFilter` (exception `title`/`detail`, including Zod message arrays joined from `BadRequestException`), and the `ZodValidationPipe` (Zod issue strings). Zod 4 is a Standard Schema implementer.

### Decision

Introduce the official **`@nestjs/i18n`** (NestJS org, first-party, zero runtime dependencies, peer deps `@nestjs/common|core ^12.1.0`, `@standard-schema/spec ^1.0.0`) as the single i18n foundation:

- **Locale configuration:** `defaultLocale: 'en'`, `supportedLocales: ['en', 'fa']` pinned explicitly (loaded catalog directories never widen the set), `fallbacks: { 'fa-IR': 'fa', 'en-US': 'en' }`. English is the default and the catalog source of truth.
- **Locale resolution:** `AcceptLanguageLocaleResolver` as the only active resolver, registered in one centralized `I18nModule.forRootAsync` call with an in-place comment block documenting exactly how to add further resolvers (import source, registration point, input configuration, ordering = precedence, supported-locale requirement, tests to add). Missing header, unsupported languages, and `q` values resolve per the library's documented behavior; regional identifiers fall back to their base language.
- **Request isolation:** the library's middleware + AsyncLocalStorage context. No mutable global locale state; concurrent requests cannot interfere.
- **Response headers:** `responseHeaders: true` (library default) sets `Content-Language` and `Vary: Accept-Language`.
- **Catalogs:** JSON, per locale, namespaced files (`common`, `validation`, `errors`, `otp`) under `apps/api/src/i18n/{en,fa}/`, shipped to production through `nest-cli.json` `compilerOptions.assets` → `dist/i18n/**` (covered by turbo `outputs: dist/**` and the production image's `COPY dist`), loaded via `JsonI18nLoader({ path: join(import.meta.dirname, 'i18n'), watch: <development only> })`.
- **Missing-key policy:** `'throw'` in development and test (fail visibly), `'fallback'` (to English, with diagnostics) in production.
- **Type safety:** the English catalog is type-imported and augmented into `I18nTypes`, making unknown keys a compile error.
- **Integration by adaptation, not replacement:** the existing `ZodValidationPipe`, `AppHttpException`, `ProblemDetailsFilter`, and `ResponseEnvelopeInterceptor` keep their responsibilities and output shapes. Only message production is localized: Zod schema messages reference catalog keys (`i18nIssueMessage`), the pipe translates issues before formatting; services throw `AppHttpException(code, t(key, args), status)`; the filter translates `title` and generic fallback details at response time; the envelope translates only `message`. HTTP statuses, `ErrorCode` values, and envelope/error structures are unchanged.
- **Non-goals:** no locale other than `en`/`fa`; no additional resolvers activated; no translation of JSON property names, error codes, enum identifiers, health machine fields, ioredis error passthrough, env-schema operator messages, or logs; the Fastify-level request-ID rejection stays English (it runs before the i18n middleware).

### Reasons

- First-party package: guaranteed NestJS 12 alignment, maintained by the Nest team; peers match the installed Nest 12.2.0 exactly.
- Native Standard Schema support fits Zod 4 without a wrapper.
- AsyncLocalStorage context resolves locale per request with no scoped proxies and works from singleton services.
- All behaviors the task requires — q-value parsing, regional fallback, plural categories via `Intl.PluralRules`, missing-key policy, response headers, typed keys — are built in.

### Alternatives Considered

- _`nestjs-i18n` (toonvanstrijp) 10.8.5:_ mature and widely used, but lacks a Standard Schema validation pipe, declares `peerDependencies: "*"` (no Nest 12 contract), and is community-owned. Rejected in favor of the first-party package.
- _Custom minimal i18n (~200 lines):_ feasible, but re-implements Accept-Language negotiation, plural rules, fallback chains, and cache headers — worse than using the platform's official module.
- _Translate centrally in the exception filter only:_ would couple the filter to every throw site's keys and lose throw-time interpolation arguments; rejected.

### Consequences and Trade-offs

**Positive**

- A single, typed catalog source of truth; adding a language is a new directory plus a `supportedLocales` entry.
- Validation, error, and success message localization with no change to wire contracts.
- Dev/test failures on missing keys keep catalogs honest; production degrades to English with diagnostics.

**Negative**

- `@nestjs/i18n` is young (first releases, 0.x). Maturity risk accepted in exchange for first-party stewardship; bugs found in the package are reported upstream (and contributed back where practical) rather than worked around silently.
- JSON catalogs must be manually kept structurally consistent; catalog-consistency tests enforce this.
- Error message text becomes locale-dependent; consumers must keep relying on `code`/`status`/`type` (already the documented contract).

### References

- `apps/api/src/shared/i18n/` (module registration), `apps/api/src/i18n/{en,fa}/` (catalogs), `apps/api/src/shared/pipes/zod-validation.pipe.ts`, `apps/api/src/shared/filters/problem-details.filter.ts`, `apps/api/src/shared/interceptors/response-envelope.interceptor.ts`
- Official documentation: `https://docs.nestjs.com/application/i18n`

---

---

## ADR-022: Centralized Logging with Grafana Alloy, Loki, and Grafana

- **Status:** Accepted
- **Date:** 2026-11-11

### Context

The API logs structured JSON through the existing Pino pipeline (ADR-008/009) to stdout, and every other container logs to stdout/stderr as well. Investigating behavior across containers today means `docker logs` per container: no cross-service search, no persistence beyond the Docker json-file rotation, no level filtering, no request-ID correlation across services, and nothing survives container recreation. The project needs a beginner-friendly, self-hosted centralized logging environment that (a) integrates into the existing Docker infrastructure without redesigning it, (b) preserves the existing application logger untouched, and (c) doubles as a practical learning environment for the observability ecosystem (metrics and tracing are explicitly out of scope for this phase).

### Decision

Introduce an independently managed **monitoring Compose stack** (`compose.monitoring.yml`, project `neo-bank-monitoring`) with three version-pinned services on an isolated network, alongside a documentation set (`docs/observability/`) including a Persian learning guide:

- **Grafana Alloy** (`monitoring/alloy/config.alloy`) collects logs through the Docker daemon socket: `discovery.docker` discovers only running containers of the `neo-bank-dev`/`neo-bank-prod` Compose projects, `discovery.relabel` derives low-cardinality labels (`env`, `service`, `container`) from the container name (guarded by a `keep` rule), `loki.source.docker` tails container stdout/stderr with a persisted positions file, `loki.process` parses pino JSON (numeric `level` → label, `time` → timestamp), and `loki.relabel` maps pino level numbers to names. High-cardinality values (request IDs, user IDs) stay in the log body and are never labels.
- **Grafana Loki** (`monitoring/loki/loki.yml`) runs as a single binary with filesystem storage on a named volume, TSDB schema v13, and 7-day retention enforced by the compactor — sized for a local learning environment.
- **Grafana** (`monitoring/grafana/`) provisions the Loki data source and one practical investigation dashboard as code (loopback-only port, admin credentials via the monitoring env file, no self-signup, telemetry disabled).
- **Independence:** the monitoring stack has its own project name and network; no application service joins it and no application depends on it. Stopping monitoring never stops the applications; Alloy buffers and retries pushes while Loki is unavailable. The socket mount is the single privileged surface (`:ro` mount, `no-new-privileges`, supplemental docker GID instead of root) and is documented as local-only.
- **Logger preservation:** the existing Pino logger and its contract are unchanged. One optional env variable, `LOG_PRETTY` (exact strings `true`/`false`), overrides the pretty-print default; the development Compose stack sets `LOG_PRETTY: 'false'` so the containerized API emits structured JSON for collection, while host-side development keeps `pino-pretty`. Unset behavior is exactly as before.
- **Log rotation:** all Compose services (dev, prod, monitoring) get bounded json-file logging (`max-size: 10m`, `max-file: 3`) so host-side container logs can no longer grow without limit.

### Alternatives Considered

- _Promtail instead of Alloy:_ the legacy collector is in maintenance mode (LTS only until 2026-03-01); its successor Alloy implements the same `loki.*` pipeline stages in the River language. Rejected to avoid adopting a deprecated component on day one.
- _OpenTelemetry Collector:_ the general-purpose telemetry collector would require application instrumentation changes (the task forbids replacing the logger) and adds concept overhead before the basics are learned. Deferred to the observability roadmap (tracing phase).
- _Collection via mounted json-file log directories:_ binds Alloy to the host filesystem layout and Docker's log format, and breaks where `local` or journald drivers apply. Docker API tailing is format-stable and container-dynamic. Rejected.
- _Embedding monitoring services into `compose.dev.yml`/`compose.prod.yml`:_ couples application startup to monitoring, contradicts the independence requirement, and makes `down` of one stack affect the other. Rejected in favor of a separate file.
- _Keeping dev on pino-pretty and parsing pretty lines in Alloy:_ fragile (ANSI color codes, level names embedded in prose) and defeats the structured pipeline. Rejected in favor of the `LOG_PRETTY` override.

### Consequences and Trade-offs

**Positive**

- Every container's logs are searchable in one place within minutes of starting the stack: filter by service/env, find errors, correlate by request ID — with zero application-code change beyond the optional `LOG_PRETTY`.
- The learning objective is served by a deliberately small, fully documented pipeline where each configuration line maps to a guide chapter.
- Log collection, storage, and visualization can be stopped, restarted, and upgraded independently of the applications.

**Negative**

- The Alloy container holds full Docker daemon control through the socket (mount read-only, `no-new-privileges`, non-root + supplemental GID). Acceptable locally; a production deployment must front the socket with a restricted read-only API proxy or move collection into the platform.
- Single-replica Loki on local disk: no high availability, no backup — a learning configuration, explicitly not production-grade.
- Loki's index model (label-based) rewards low cardinality; adding per-request labels would degrade it. The guide and comments teach the boundary.
- Three additional pinned images on the machine (Loki 211 MB, Grafana ~2 GB, Alloy 945 MB uncompressed).

### References

- `docker/compose.monitoring.yml`, `docker/env/.env.monitoring.example`, `monitoring/alloy/config.alloy`, `monitoring/loki/loki.yml`, `monitoring/grafana/provisioning/`, `monitoring/grafana/dashboards/api-logs.json`
- `docker/compose.app.dev.yml` (`LOG_PRETTY`, log rotation anchors), `docker/compose.app.prod.yml` (log rotation), `apps/api/src/shared/config/env/schema/log.env.ts`, `apps/api/src/shared/config/log.config.ts`
- `docs/observability/README.md` (operations), `docs/observability/manual-testing.md` (verification scenarios), `docs/docker.md` (ports, rotation)
- Official documentation: https://grafana.com/docs/loki/latest/ · https://grafana.com/docs/alloy/latest/ · https://grafana.com/docs/grafana/latest/

---

---

## ADR-023: Project-Level Multi-Agent Development Workflow (ZCode + Claude Code)

- **Status:** Accepted
- **Date:** 2026-11-11

### Context

Development sessions currently rely on a single agent performing exploration, code review, security analysis, and documentation serially. The repository's mandatory context-blind judge requirement (root `AGENTS.md`) is handled ad hoc per task, with no version-controlled review workflow. The project needs a repeatable, project-level multi-agent system that works natively with both ZCode (3.17.2) and Claude Code (2.1.316), enforces tool restrictions through platform mechanisms rather than prompt instructions alone, keeps agent behavior identical across platforms, and is fully version-controlled — while remaining extensible to future agent platforms and introducing no new dependencies or application-code changes.

Verified platform facts driving the decision: ZCode supports subagents only through plugins (no workspace-scope custom subagents); its plugin manifest is `.zcode-plugin/plugin.json` with `.claude-plugin/plugin.json` recognized as a compatibility fallback; plugins are installed manually per developer from a local marketplace directory and are never auto-enabled from a repository clone. Claude Code discovers project-level subagents natively from `.claude/agents/*.md` (same markdown + YAML frontmatter format) and supports project-level hooks in `.claude/settings.json`; both platforms support SessionStart hooks that inject `additionalContext` into the conversation, and neither a hook nor any native mechanism is guaranteed to expose subagent identity to `PreToolUse` hooks.

### Decision

Adopt a **platform-neutral canonical agent-definition layer** as the single source of truth, synchronized by a dependency-free Node script into native platform artifacts:

- **Canonical definitions** (`.agents/definitions/`): four subagents — `project-explorer`, `code-reviewer`, `code-security-analyzer`, `documentation-writer` — each with YAML frontmatter (identity, description, tool allowlist) and a structured body (responsibilities, input expectations, output contract, restrictions, review criteria). Reviewer independence and change-based context-delivery rules are embedded in the definitions so both platforms inherit them identically.
- **Synchronization** (`scripts/agents/sync.mjs`): reads canonical definitions and generates (a) ZCode plugin agents under `.agents/plugins/monorepo-workflow/agents/` and (b) Claude Code project agents under `.claude/agents/`, applying per-platform frontmatter adaptations (ZCode `thoughtLevel`/`color`; `model` omitted on both so each platform uses its session model). Generated files are committed to Git; `sync.mjs --check` is a non-mutating drift check. No new dependency is introduced.
- **ZCode integration**: a local plugin `.agents/plugins/monorepo-workflow/` with manifest `.claude-plugin/plugin.json` — the one manifest path both platforms recognize — plus both marketplace manifest locations (`.agents/plugins/marketplace.json` for ZCode, `.agents/plugins/.claude-plugin/marketplace.json` for Claude Code). Installation is a documented one-time manual step per developer (add marketplace directory in Settings → Plugin Management, install, enable).
- **Claude Code integration**: native project-level `.claude/agents/` (works from a fresh clone with zero install) and `.claude/settings.json` hooks.
- **Session initialization**: SessionStart hooks on both platforms (ZCode plugin `hooks/hooks.json`, Claude Code `.claude/settings.json`) run `session-start.mjs`, which emits `additionalContext` instructing the primary agent to invoke `project-explorer` before substantive work. A hook injects instruction only; the primary agent performs the actual delegation. The explicit root `AGENTS.md` instruction remains as documented fallback.
- **Permission enforcement (native, not prompt-only)**: `project-explorer`, `code-reviewer`, and `code-security-analyzer` are strictly read-only via native tool allowlists (`Read`, `Grep`, `Glob`); no subagent receives `Bash`, so no subagent can execute tests. Documentation-writer write enforcement is verification-driven: if runtime verification confirms hook-input subagent identity, a `PreToolUse` path-guard hook enforces documentation-only writes; otherwise both platforms use the sanctioned fallback — a read-only Documentation Writer producing ready-to-apply patches that the primary agent applies. The verified outcome is recorded in the feature record.
- **Workflow codification**: the mandatory development workflow (session init → implementation → code review → security review → parallel documentation/testing → reconciliation → final validation → completion) and review-loop controls (max 3 fix/re-review iterations per phase, finding-ID persistence, `OPEN`/`FIXED`/`DISPUTED` tracking, escalation to the developer) are codified in `.agents/workflows/development-workflow.md`; report contracts (Project Context, Code Review, Security Review, Documentation Change) live in `.agents/schemas/`. Root `AGENTS.md` carries a concise multi-agent section referencing the canonical definitions; root `CLAUDE.md` imports it via `@AGENTS.md`.

### Alternatives Considered

- _User-level ZCode subagents_ (`~/.zcode/agents/`): not project-distributable, contradicts the version-control requirement. Rejected.
- _Two independently maintained prompt sets per platform_: guarantees drift and violates the single-source-of-truth requirement. Rejected in favor of generated adapters.
- _Workspace `.zcode/config.json` hooks for SessionStart instead of a plugin_: configuration-file hooks require per-developer `hooks.enabled: true` and the configuration cannot carry the plugin agents; plugin hooks auto-enable the hook runner. Rejected for the primary mechanism.
- _An agent-orchestration framework dependency_: YAGNI — both platforms provide native delegation; a framework adds supply-chain surface without concrete value. Rejected.
- _Granting Documentation Writer unconditional write access_: violates the enforcement requirement; the verification-driven guard-or-fallback approach preserves safety at the cost of one verification step. Chosen.

### Consequences and Trade-offs

**Positive**

- Identical agent behavior, review criteria, and report contracts across platforms from one canonical source.
- Generated files are committed: Claude Code works from a fresh clone with zero setup; ZCode needs one documented manual install.
- Reviewer independence and read-only restriction are enforced by platform tool allowlists, not prompts; no subagent can execute commands or tests.
- Change-based context delivery (git diffs + targeted file lists) bounds token consumption; parallel documentation/testing shortens cycles.

**Negative**

- ZCode requires a one-time manual plugin install/enable per developer; the in-repo plugin is silently inert until then.
- Generated agent files exist twice in Git (plugin + `.claude/`); drift is mitigated by `sync.mjs --check` but is a real duplication.
- SessionStart hooks inject instructions only — delegation itself is enforced by instruction and convention, not by the platform.
- Documentation-writer write enforcement may degrade to the patch-producer fallback if hook identity verification fails, making doc updates slightly more indirect.
- Two marketplace manifest files are maintained for two platforms; contained by the sync script but an accepted duplication.

### References

- `.agents/definitions/` (canonical subagent definitions), `.agents/workflows/development-workflow.md`, `.agents/schemas/`, `.agents/plugins/` (ZCode plugin + marketplaces), `scripts/agents/sync.mjs`, `.claude/agents/`, `.claude/settings.json`, root `AGENTS.md`, root `CLAUDE.md`
- Verified platform documentation: ZCode configuration-guide and plugin-creator skills (installed client 3.17.2), Claude Code 2.1.316 CLI (`claude plugin validate`, project agents, hooks)

---

## ADR-024: Use MockServer for Development-Time Resilience Testing

- **Status:** Accepted
- **Date:** 2026-11-12

### Context

The API is about to gain outbound HTTP integrations (the SMS provider is the first planned dependency), and resilience patterns around those integrations — bounded timeouts, capped retries, failure handling, recovery — only prove their value under abnormal downstream conditions: timeouts, HTTP 5xx responses, delayed responses, consecutive failures followed by success, and recovery after temporary outages. Ordinary successful responses cannot exercise any of these paths, and there is currently no repeatable way to simulate a misbehaving downstream service. No outbound HTTP client exists yet, so this infrastructure must be in place before the first integration lands — without it becoming a production dependency or leaking into any non-development environment.

### Decision

Adopt **MockServer** (`mockserver/mockserver:9.2.0`, version-pinned) as the development-time HTTP mocking service for simulating downstream HTTP service behavior:

- **Development stack only:** the service is defined exclusively in `docker/compose.app.dev.yml` (`mockserver` service); the production Compose files cannot inherit it. It maps host port `${MOCKSERVER_PORT:-1080}` — explicitly bound to `127.0.0.1`, since the control API is unauthenticated and capable of forwarding requests — to the image default port 1080 and uses the shared `x-logging` anchor. No volumes: expectations are ephemeral, so every container restart starts from a clean state.
- **Image-native healthchecking:** the 9.2.0 default image is distroless (no shell, no curl/wget) and ships a built-in `HEALTHCHECK` probing `PUT /mockserver/status`; no custom healthcheck is added.
- **No startup coupling:** no `depends_on` relationship with the API. MockServer must never be a mandatory startup dependency; the API merely logs its addresses.
- **Startup visibility through the existing pattern:** the dev Compose stack injects two optional environment variables — `MOCKSERVER_HOST_URL` (host access) and `MOCKSERVER_DOCKER_URL` (compose network) — and the API startup log prints them in development only, following the `REDIS_INSIGHT_URL` precedent (ADR-020): unset everywhere else, nothing logged, no fabricated addresses.
- **Single-port control surface:** the control API, mocked endpoints, and dashboard share port 1080 (`PUT /mockserver/expectation`, `PUT /mockserver/clear`, `PUT /mockserver/reset`, `PUT /mockserver/status`, `/mockserver/dashboard`).
- **Not a test dependency:** Testcontainers-based tests (ADR-016) never use the dev Compose stack; MockServer exists for manual and interactive resilience verification. Running MockServer does not redirect any API traffic — an application dependency must be explicitly configured to target it.

### Alternatives Considered

- _WireMock:_ equally capable JVM-based HTTP mock, but its primary distribution and tooling are Java-centric, while MockServer offers a language-neutral REST control API, a live dashboard, and built-in chaos features out of the box; the Docker-first workflow fits this repository better. Rejected.
- _Toxiproxy:_ operates at the network layer (latency, bandwidth, connection drops) but cannot shape HTTP responses (status codes, bodies, sequences). It complements rather than replaces an HTTP mock; network-level fault testing is a separate future concern. Rejected for this purpose.
- _Custom mock HTTP service:_ a small home-grown mock would need continuous maintenance to cover matching, sequencing, and delays — a solved problem in MockServer. Rejected (YAGNI).
- _Manually simulating failures (unreachable hosts, ad-hoc scripts):_ not repeatable, not observable, and cannot produce precise 5xx/delay/sequence scenarios. Rejected.

### Consequences and Trade-offs

**Positive**

- Repeatable, observable resilience scenarios (timeouts, 5xx bursts, delays, failure-then-recovery) against a real HTTP endpoint.
- The live dashboard and request log make downstream interaction visible during development.
- Strictly development-only: production startup, configuration, and logs are unchanged; the image runs as non-root and carries no credentials.
- Alloy (ADR-022) collects the container's stdout automatically — no extra wiring.

**Negative**

- One additional development container consuming memory (~JVM footprint).
- Application dependencies must be explicitly configured to target MockServer; nothing is redirected implicitly, so resilience tests require deliberate wiring.
- Application-level HTTP mocking does not replace network-level fault testing (connection resets, bandwidth starvation) — Toxiproxy or similar remains a possible future addition.
- Expectations are stateful: scenarios must reset (`PUT /mockserver/reset`) between tests to stay isolated.

### References

- `docker/compose.app.dev.yml` (mockserver service, api environment), `docker/env/.env.docker.example` (MOCKSERVER_PORT), `apps/api/src/shared/http/startup-url.ts`, `apps/api/src/main.ts`, `apps/api/src/shared/config/env/schema/server.env.ts` (optional MockServer URLs)
- `docs/docker.md` (MockServer section, ports table)
- Official documentation: https://www.mock-server.com/, image: https://hub.docker.com/r/mockserver/mockserver

---

## ADR-025: Manage the E2E Redis with Testcontainers

- **Status:** Accepted
- **Date:** 2026-11-13

### Context

The e2e suite (`pnpm test:e2e`, 14 `*.e2e-spec.ts` files) requires a reachable Redis: guarded routes (rate limiting, OTP) fail closed without one. The suite currently depends on the **development Compose stack being up** — `apps/api/env/.env.test` points `REDIS_URL` at the dev stack's host-published Redis (`127.0.0.1:6380`), so a developer must manually start a long-running stack before every e2e run, and leftover state (rate-limit keys, OTP lockouts) leaks between runs. This also contradicts the repository's own documentation, which already claims e2e tests use Testcontainers. The Redis integration tier (`pnpm test:redis`) has managed its own Redis with Testcontainers per test file since ADR-016, proving the pattern works in this repository.

### Decision

The e2e suite manages its own Redis with Testcontainers: **one shared container per test execution**, started by a Vitest `globalSetup` file and stopped by its teardown.

- **Reuse, don't replace:** the existing `TestRedis` helper (`apps/api/test/testcontainers.ts` — `GenericContainer('redis:8.2-alpine')`, dynamic mapped port, `REDIS_PASSWORD`, log wait strategy) is used unchanged; the `test:redis` tier keeps its per-file container model untouched.
- **No env mutation, no fixed ports:** the container's connection config is passed from the global setup to the test workers through Vitest's native `provide`/`inject` channel (verified against the installed vitest 5.0.5). `create-test-app.ts` builds a client from the injected config via the existing `createRedisClient` helper and overrides the `REDIS_CLIENT` provider — the mechanism the `test:redis` tier already uses. Overriding the `REDIS_CONFIG` token alone does not work: `@nestjs/config`'s `ConfigService` holds the `registerAs` factory result and does not observe provider overrides on the namespace token (proven by the validation run). `RedisService` still owns the connection lifecycle; the app-side wiring stays exercised. No per-spec changes.
- **Failure-safe cleanup:** the global setup's teardown stops the container after the run, including failing runs; Testcontainers' default resource reaper (ryuk) reaps orphans after a crashed process.
- **`.env.test` placeholders:** `REDIS_URL`/`REDIS_USERNAME`/`REDIS_PASSWORD` remain present (the Zod schema validates at import) but become documented validation-only placeholders; the connection comes exclusively from the container config.
- **Docker becomes an e2e requirement:** `pnpm test:e2e` now needs a running Docker daemon — it already needs one for `pnpm test:redis`; `turbo.json` already passes `DOCKER_HOST`/`DOCKER_CONTEXT` to test tasks. No new dependency: the container lifecycle uses the already-installed core `testcontainers` package. The never-imported `@testcontainers/redis` and `@testcontainers/postgresql` wrapper sub-packages are removed (developer-approved: core functionality covers both suites; the Redis helper deliberately uses `GenericContainer` because `RedisContainer` lacks `withUsername()`, and the Postgres wrapper can be re-added when a database integration actually lands).

### Alternatives Considered

- _Keep the manual dev-stack dependency:_ the stated problem — manual work and non-reproducibility — remains. Rejected.
- _One container per test file (the `test:redis` model):_ 14× container starts and lifecycle boilerplate for isolation the e2e suite does not need — its specs are HTTP-contract tests that already share one Redis server (the dev stack's) today. Rejected for e2e; per-file remains correct for the redis tier, whose specs exercise Lua/TTL/atomicity semantics directly.
- _One container per test:_ disqualifying startup overhead. Rejected.
- _In-process fake (e.g. ioredis-mock) or embedded server:_ not real Redis behavior; the guarded routes depend on real throttler and OTP semantics. Rejected.

### Consequences and Trade-offs

**Positive**

- `pnpm test:e2e` is self-sufficient: no manually started containers, no dev stack, no fixed host port (dynamic allocation removes the 6380 workaround for the busy 6379).
- Fresh Redis per run eliminates cross-run state leakage — strictly more reproducible than the long-lived compose Redis.
- Documentation and implementation stop contradicting each other.
- One container per run keeps startup overhead at ~1–2 seconds (image cached after first pull).

**Negative**

- The Docker daemon is now required to run the e2e suite (previously optional for it).
- The e2e suite runs against `redis:8.2-alpine` instead of the dev stack's `redis-stack` image; the API uses only core Redis commands and the redis tier already validates against the same image, but the server software differs from the dev environment.
- State is shared across the run inside one container — identical to today's shared compose Redis, so no isolation regression, but suite-level key hygiene remains each spec's responsibility.

### References

- `apps/api/test/e2e.global-setup.ts` (new), `apps/api/test/vitest-e2e.config.ts`, `apps/api/test/create-test-app.ts`, `apps/api/test/testcontainers.ts` (reused unchanged), `apps/api/env/.env.test`
- ADR-016 (Testcontainers for the Redis integration tier), `docs/current-state.md` (testing section), `apps/api/AGENTS.md` / `apps/api/ONBOARDING.md` (test commands)
- `prompts/_038-e2e-testcontainers.md`

---

## ADR-026: Memory-Based Load Shedding and Health-Aware Readiness

- **Status:** Accepted
- **Date:** 2026-11-13

### Context

The API is a single Node.js process. Under severe memory pressure it keeps accepting new requests until the kernel's OOM killer (or the runtime) terminates it: there is no protection state, no signal to an orchestrator, and no graceful degradation. The health endpoint (`GET /health`, Terminus) has exactly one indicator (Redis PING) that reports `degraded` with HTTP 200 — the 503 path is unreachable — and there is no readiness/liveness distinction. No orchestrator is in use today (Docker Compose stacks), but Kubernetes compatibility is a design goal, and the Compose healthcheck probes `/health` — so `/health`'s "process is alive" semantics must be preserved.

### Decision

Introduce **memory-based load shedding**: a centralized, configuration-driven protection state driven by the process's own RSS, exposed through request rejection and a readiness endpoint.

1. **Signal — RSS, sampled in-process.** `process.memoryUsage().rss`, sampled by a dedicated `MemoryProtectionService` (`src/shared/memory-protection/`) on a fixed interval (default 5 s, lifecycle-bound to the application via bootstrap/shutdown hooks). RSS is the footprint the kernel, cgroups, and the OOM killer act on; heap-only metrics miss Buffers, external, and native memory. Sampling costs microseconds — negligible.
2. **State machine with hysteresis.** `Ok → Protected` when a single sample crosses the activation threshold (`MEMORY_PROTECTION_MAX_RSS_MB`) — fail-fast protection. `Protected → Ok` only after RSS stays below the lower recovery threshold (`MEMORY_PROTECTION_RECOVERY_RSS_MB`) for `MEMORY_PROTECTION_STABLE_SAMPLES` consecutive samples — sustained improvement, no flapping, no arbitrary fixed cooldown. Transitions are logged (warn on protecting, info on recovery) through the existing Pino logger.
3. **Request rejection — a global admission guard.** `MemoryProtectionGuard`, registered as `APP_GUARD` **before** `RedisThrottlerGuard` (cheapest rejection first, no Redis dependency on the rejection path). While `Protected`, non-exempt requests receive **HTTP 503 Problem Details** through the existing `ProblemDetailsFilter`: stable `code: SERVICE_UNAVAILABLE`, the application-error Problem Type, localized title/detail (bilingual), and a `Retry-After` header set to the seconds until the next sample. Exemptions via a `@SkipMemoryProtection()` metadata decorator on the health endpoints and the Problem-Type docs page.
4. **Readiness/liveness split.** `/health` remains byte-identical (process liveness; degraded Redis still → HTTP 200, so the Compose healthcheck can never restart a pressured container). New `GET /health/ready` (version-neutral, prefix-excluded, unthrottled, memory-exempt) runs Terminus over Redis (strict: reports `down` on ping failure) and memory (reports `down` while `Protected`) — any `down` yields HTTP 503, otherwise 200.
5. **Guard and readiness are combined deliberately.** Failing readiness alone does **not** stop direct traffic: control-plane propagation lags, non-orchestrated environments (Compose today) have no orchestrator to react, and NodePort/direct traffic bypasses load-balancer routing entirely. The guard closes those windows locally; readiness handles orchestrated routing.
6. **Configuration.** New `MEMORY_PROTECTION` namespace (Zod schema + `registerAs` symbol token, existing conventions): `MEMORY_PROTECTION_ENABLED` (default `true`), `MEMORY_PROTECTION_MAX_RSS_MB` (default `1024`), `MEMORY_PROTECTION_RECOVERY_RSS_MB` (default `768`, cross-field-validated below the activation threshold), `MEMORY_PROTECTION_SAMPLE_INTERVAL_MS` (default `5000`), `MEMORY_PROTECTION_STABLE_SAMPLES` (default `3`). No new dependency — Node built-ins only.

### Alternatives Considered

- _Fastify `onRequest` hook / middleware:_ earliest and cheapest, but bypasses the exception filter and i18n — it would hand-build a second copy of the Problem Details contract and exempt routes by URL string matching. Rejected (DRY/KISS).
- _Interceptor:_ runs after guards; the guard is the semantically correct admission layer and composes with metadata exemptions. Rejected.
- _Readiness-only (no local rejection):_ does not stop direct traffic and fails the stated requirement ("new incoming requests receive an appropriate HTTP response"). Rejected as the sole mechanism; adopted in combination.
- _heapUsed / heapTotal / cgroup-derived fraction:_ heap metrics miss non-heap memory; deriving thresholds from cgroup limits couples the application to Linux filesystem details and deployment internals. Rejected in favor of explicit absolute MB thresholds.
- _Sampling in a separate worker/process:_ over-engineering for a single microsecond-scale metric in a single-process application (YAGNI). Rejected.
- _External/infrastructure-level shedding (load balancer checks):_ no in-process memory signal exists for them to act on. Rejected.

### Consequences and Trade-offs

**Positive**

- Graceful degradation: under memory pressure the service sheds load with a standard, localized 503 + `Retry-After` instead of dying mid-request.
- Orchestrator-compatible signals: readiness (503) and liveness (unchanged 200) are distinct, matching Kubernetes probe semantics exactly.
- Health and docs endpoints stay reachable during protection; recovery is automatic and hysteresis-stabilized.
- Zero dependencies; uses the existing error, i18n, health, and logging conventions end to end.

**Negative**

- Thresholds must match the deployment's real memory limit: too high never sheds (OOM kill remains possible), too low causes false 503s.
- Pressure between samples is invisible for up to one interval; requests already accepted are not shed.
- RSS is a practical proxy for container memory, not an exact cgroup mapping.
- Event-loop starvation delays sampling (acceptable: a blocked loop cannot serve requests anyway).
- The mechanism sheds load; it does not reclaim memory or fix leaks.

### Operational Implications

- **Kubernetes:** `readinessProbe → GET /health/ready`, `livenessProbe → GET /health`. Under pressure the pod leaves the Service endpoints (no new routed traffic), in-flight requests finish, liveness never fails on memory (no restart loops making pressure worse), and the guard covers direct/NodePort traffic plus the control-plane reaction window. Recovery returns the pod to rotation automatically.
- **Docker Compose:** the guard is the only shedding layer (no orchestrator); the container healthcheck (`/health`) intentionally stays healthy during protection.

### References

- `apps/api/src/shared/memory-protection/` (service, guard, indicator, decorator, config), `apps/api/src/shared/config/env/schema/memory-protection.env.ts`, `apps/api/src/modules/app/health.controller.ts` (`/health/ready`), `apps/api/src/modules/app/app.module.ts` (guard registration order), `apps/api/src/shared/errors/error.code.ts` (`ServiceUnavailable`)
- `prompts/_039-memory-load-shedding.md`

---

## ADR-027: Use MikroORM v7 with PostgreSQL for Persistence

- **Status:** Accepted
- **Date:** 2026-11-14

### Context

The API's core domain — enrollments today, banking features that follow — needs durable relational persistence. PostgreSQL is already provisioned in both Compose stacks (pinned `postgres:17.6-alpine`, named volumes, `pg_isready` healthchecks, service-healthy startup ordering) but nothing connects to it. The persistence layer must fit the established architecture: NestJS 12 on Fastify, ESM with `#` subpath import aliases, Zod-validated configuration exposed only through `ConfigService` (ADR-004), global infrastructure modules owning their connection lifecycle behind an application-level abstraction (ADR-012/013), Terminus health reporting with degraded-liveness versus strict-readiness semantics (ADR-026), Testcontainers-based testing (ADR-016/025), and explicit SQL migrations — never schema synchronization. Type safety is strict end to end (`strict` TypeScript, no `any`, no unsafe assertions), and TypeScript is pinned to 6.0.3 because the Nest CLI requires the 6.x compiler API.

An ORM is appropriate here rather than a raw client: the domain needs entity modeling, transactional integrity across related rows, and a migration workflow a team can review. The requirements are: decorator/entity-class modeling compatible with the existing SWC + `tsc` pipeline, per-request isolation for a shared `EntityManager` (identity map) without making every service request-scoped, first-class TypeScript typing, a NestJS integration that consumes configuration through `ConfigService`, explicit migrations, and ESM/NodeNext compatibility.

### Decision

Adopt **MikroORM v7** with the `@mikro-orm/postgresql` driver as the only database access layer, integrated through `@mikro-orm/nestjs`'s `MikroOrmModule.forRootAsync()` with the driver supplied beside `useFactory`, `autoLoadEntities: true`, and an explicit `ReflectMetadataProvider` (v7 moved decorators to `@mikro-orm/decorators/legacy` and no longer defaults to reflection metadata; the existing SWC `decoratorMetadata` + `emitDecoratorMetadata` pipeline already emits the metadata it reads — no compiler change).

- **Data Mapper + Unit of Work + Identity Map:** entities are plain classes; change tracking happens in the unit of work and persistence is explicit (`em.flush()`, `em.transactional()`), giving reviewable transaction boundaries — the property a banking domain most needs.
- **NestJS integration:** `forRootAsync` reads `DATABASE_URL` from the existing `ConfigService` (a new `DATABASE_CONFIG` namespace follows ADR-004; no parallel configuration mechanism). `registerRequestContext` middleware establishes a per-request forked `EntityManager` under the default singleton DI scope — the same consumption model as Redis (global module, injected services, no request-scoped cascade). Background/non-HTTP execution uses `@CreateRequestContext()` (from `@mikro-orm/decorators/legacy`) or an explicit `em.fork()`; this convention is documented for future features, and no background jobs are introduced by this decision.
- **Startup semantics: bounded-retry initial connection at bootstrap** (amended 2026-11-14, see the Amendment below). The initial connection is established during bootstrap with a bounded retry; startup fails when the database cannot be reached. After a successful boot, an unreachable PostgreSQL degrades `/health` (HTTP 200) and fails `/health/ready` (503) via MikroORM's `checkConnection()`. The database URL itself is mandatory configuration and fails env validation at boot when missing or malformed (ADR-004).
- **Migrations:** `@mikro-orm/migrations` with a single shared options builder used by both the NestJS runtime factory and the standalone CLI configuration (`MIKRO_ORM_CLI_CONFIG`; the CLI cannot use Nest DI, so its config loads the URL through the existing env-validation layer and Node `--env-file`). Migration paths live inside the database module (`src/shared/database/migrations/`), with `path` (compiled) and `pathTs` (source) matching the build output. Migration creation and execution stay explicit developer commands (`db:migration:create`, `db:migration:up`, `db:migration:down`); `schema:update`, schema synchronization, and generated schema commands are never introduced, and generated migrations are reviewed before execution.
- **Explicit v7 precedence behavior:** explicit configuration values have precedence over environment variables in MikroORM v7, so the URL is always passed explicitly by the caller (ConfigService in the runtime, the validated env in the CLI) — deployment overrides never silently alter explicitly configured values.
- **Scope of this change:** infrastructure only — the database module, configuration, health indicator, and migration plumbing. No entities, repositories, or business logic; the first entity lands with the feature that needs it.

### Alternatives Considered

- _TypeORM:_ the most established NestJS pairing and the largest community. Rejected: maintenance cadence has been slow for years, relation typing relies on `design:*` reflection that degrades under this project's SWC pipeline, and it lacks a comparable Unit of Work — change tracking is weaker exactly where a banking domain needs it strongest.
- _Prisma:_ excellent type safety and schema workflow, actively maintained. Rejected: the schema-first `.prisma` DSL instead of entity classes conflicts with the decorator/`forFeature` module model this codebase is built around; no Identity Map or Unit of Work; the client's engine/runtime adds supply-chain surface; its NestJS integration is no longer official.
- _Drizzle ORM:_ lightweight, SQL-adjacent, great typing. Rejected for this purpose: it is a query builder first, with no Unit of Work, no Identity Map, and no NestJS integration — change tracking, transactional aggregates, and relational lifecycle behavior would be hand-built (more code, more risk), violating the repository's simplicity rules in the opposite direction.
- _Raw `pg` client or an internal micro-ORM:_ a hand-rolled data layer within the 200–300 line dependency-evaluation threshold is unrealistic for change tracking, transactions, and migration diffing; it would duplicate a solved problem and take ownership of connection pooling and injection risks ourselves. Rejected.

### Consequences and Trade-offs

**Positive**

- Explicit persistence boundaries (`flush`, `transactional`) with per-request identity maps; typed entities without codegen; reviewable SQL migration artifacts.
- A global `DatabaseModule` shaped like `RedisModule` — one mental model for all infrastructure; health/readiness semantics stay consistent with ADR-026.
- `ReflectMetadataProvider` works with the existing SWC pipeline — no build or compiler change.

**Negative**

- A new dependency family (six `@mikro-orm/*` packages) with its own upgrade cadence; v7 is recent, so ecosystem references skew v6 and must be checked against v7 documentation.
- `@mikro-orm/nestjs` is maintained by the MikroORM organization, not the Nest core team; integration-version alignment is our responsibility.
- Reflection-based metadata has known ESM circular-import pitfalls (relation types must use `Rel<T>`/`Ref<T>`); future entities carry this rule.
- The identity map makes out-of-HTTP contexts a documented convention (`@CreateRequestContext()` / `em.fork()`) rather than something the framework enforces.
- An outage at boot delays startup by the bounded retry window (worst case ≈ 15 s of backoff plus per-attempt timeouts) before failing with a clear error; an outage after a successful boot surfaces only through health/readiness.

### Security Assessment

Dependency evaluation (per the dependency-evaluation skill) is completed at install time: the exact v7 dependency tree is reviewed from the lockfile (v7 no longer uses knex), lifecycle install scripts are checked, `pnpm audit` is run, and the latest stable v7 release is selected against Node 24, TypeScript 6.0.3, and NestJS 12. Results are reported with the implementation; anything unverifiable is stated there. No credentials are committed: `DATABASE_URL` values stay in gitignored env files and Compose interpolation files, and the health indicator passes through only host:port-class error text, never the URL.

### Operational Implications

- Compose healthchecks may keep using `/health`: a PostgreSQL outage **after a successful boot** degrades but never fails liveness, so a database outage cannot restart-loop the container. A database that is unavailable at boot prevents startup (bounded retry, then failure) — the Compose `depends_on: service_healthy` ordering plus the retry window absorbs ordinary startup races.
- Orchestrators (future Kubernetes) should probe `/health/ready`; readiness fails while the database is unreachable.
- Migration commands are operator actions against the Compose PostgreSQL service; the application never runs migrations at startup.

### Amendment 2026-11-14: Initial Connection at Startup

The non-blocking startup semantics from the original decision were amended during the graceful-shutdown and connection-resilience task (`prompts/_041`), with explicit developer approval: PostgreSQL is architecture-required for this API, so the application now establishes the initial connection during bootstrap and fails startup when it cannot.

- `DatabaseConnectionInitializer` (`OnApplicationBootstrap`) calls `orm.connect()` — the supported API; no second ORM instance and no bypass of the database module. Retries are bounded: 5 attempts including the first, exponential backoff 1 s → 2 s → 4 s → 8 s (capped), and a 5 s per-attempt timeout so a silently dropping host cannot stall the loop. No new environment variables; the limits are named constants.
- Permanent configuration and authentication failures (PostgreSQL SQLSTATE `28P01` invalid password, `28000` invalid authorization, `3D000` invalid catalog) are not retried — startup fails immediately with a meaningful error.
- If all attempts fail, startup fails: the application never serves HTTP without its required database, and no infinite retry loop exists.
- After a successful boot, runtime behavior is unchanged: a later PostgreSQL outage degrades `/health` (HTTP 200) and fails `/health/ready` (503); the pg pool re-establishes per-acquisition connections on its own.
- The root "an external service must not become a mandatory startup dependency" rule remains in force for every other service — Redis keeps its non-blocking connect — with PostgreSQL as the explicit, architecture-required exception decided here.

### References

- `apps/api/src/shared/database/` (module, options builder, CLI config, health indicator, migrations), `apps/api/src/shared/config/env/schema/db.env.ts`, `apps/api/src/shared/config/database.config.ts`, `apps/api/src/modules/app/health.controller.ts`, `apps/api/package.json` (`db:migration:*`, `test:db`), `apps/api/env/.env.example` (`DATABASE_URL`), `docker/compose.app.dev.yml` / `docker/compose.app.prod.yml` (API `DATABASE_URL` override)
- DECISIONS.md ADR-004 (env validation), ADR-012/013 (Redis integration model), ADR-016/025 (Testcontainers), ADR-026 (health semantics)
- Official documentation: https://mikro-orm.io/docs, https://mikro-orm.io/docs/usage-with-nestjs, https://docs.nestjs.com/data/mikroorm
- `prompts/_040-mikroorm-postgres-integration.md`

---

## ADR-028: Use pgAdmin 4 as the Development-Only PostgreSQL Web UI

- **Status:** Accepted
- **Date:** 2026-11-15

### Context

PostgreSQL is now a first-class part of the stack (ADR-027) and schema work happens through explicit migrations reviewed by developers. Redis already has a development web UI (Redis Insight, bundled in the dev Stack image, ADR-020); PostgreSQL has no equivalent — developers inspect and exercise the database through raw `psql` and the host port. As entities and migrations arrive, a browser-based PostgreSQL client (browsing schemas, running exploratory queries, following migration results) becomes the natural companion tool. The tool must follow the same pattern as the existing development-only services: defined exclusively in the dev Compose stack, loopback-bound, version-pinned, and completely absent from production. It must reuse the existing PostgreSQL service — never a second database instance — and register it automatically so a fresh setup needs no manual server registration in the UI.

### Decision

Adopt **pgAdmin 4** (`dpage/pgadmin4:9.19`, version-pinned; the latest stable release at adoption time, digest `sha256:3591b3d02910dcd817dec6fcaa681c278ba6966945283dd0ea0042731c330c83`, identical to `latest`/`9.19.0`/`2026-10-27-2` on Docker Hub) as the development-only PostgreSQL web UI:

- **Development stack only:** the service is defined exclusively in `docker/compose.app.dev.yml` (`pgadmin` service); the production Compose files cannot inherit it. Host port `${PGADMIN_PORT:-5050}` maps to the image-default internal port 80 and is explicitly bound to `127.0.0.1` (SEC-03 convention: dev infrastructure stays off the LAN). The shared `x-logging` anchor applies.
- **Reuses the existing PostgreSQL:** the registered server points at the compose service name `postgres:5432` with `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` from the same interpolation source the `postgres` service uses — one source of truth, no duplicated credentials. No second PostgreSQL instance exists.
- **Automatic server registration via a rendered `servers.json`:** pgAdmin does not substitute environment variables in `servers.json` (upstream gap, pgadmin-org/pgadmin4#8663), so the container entrypoint is prepended with a minimal Python render step (`docker/pgadmin/render_servers.py`, mounted read-only) that replaces `${VAR}` placeholders in `docker/pgadmin/servers.json.template` (mounted read-only) with the container's environment variables, validates the resulting JSON, and then execs the image's original entrypoint. A missing variable or invalid JSON aborts startup with a clear error. This is the only justified deviation from "no custom entrypoints": the official mechanism cannot inject the password.
- **No master-password prompt:** `PGADMIN_CONFIG_MASTER_PASSWORD_REQUIRED=False` suppresses the master-password dialog so the flow after login is prompt-free; the server password comes from the rendered definition.
- **Persistence:** a named volume `pgadmin_data` mounted at `/var/lib/pgadmin` (the image's documented data directory) stores pgAdmin's configuration database, so the registration and any user-created UI state survive container recreation. Server definitions load from `servers.json` on first launch (no `PGADMIN_REPLACE_SERVERS_ON_STARTUP`), so manual UI changes persist afterwards.
- **Startup ordering:** `depends_on.postgres.condition: service_healthy` reuses the existing `pg_isready` healthcheck — PostgreSQL healthy → pgAdmin starts. Nothing depends on pgAdmin: like Redis Insight (ADR-020) and MockServer (ADR-024), it is a manual development tool, and no application traffic flows through it.
- **Credentials:** the initial pgAdmin administrator (`PGADMIN_DEFAULT_EMAIL` / `PGADMIN_DEFAULT_PASSWORD`) is required interpolation configuration (`:?` error syntax) documented in `docker/env/.env.docker.example` and populated only in the gitignored `docker/env/.env.docker.dev`; nothing is hardcoded in tracked files.
- **Not a test dependency:** Testcontainers-based tests (ADR-016/025) never use the dev Compose stack; pgAdmin has no role in any test tier.

### Alternatives Considered

- _Redis Insight–style zero-config bundled UI:_ not available for PostgreSQL in this stack; a separate image is required. Rejected (non-option).
- _Postgres-compatible lightweight web clients (Adminer, pgweb, dbgate):_ smaller images, but pgAdmin is the reference PostgreSQL client with the deepest schema/migration/internals support, official container documentation, and dedicated maintenance from the PostgreSQL project; the alternatives trade capability and documentation quality for footprint. Rejected.
- _Plain `servers.json` without the render step (manual password entry):_ registration would still be automatic, but the user must type the password once per fresh volume and the credentials would not flow from the single interpolation source. Rejected — the render step is two lines of entrypoint and removes the manual step without adding dependencies.
- _Declarative replacement on every start (`PGADMIN_REPLACE_SERVERS_ON_STARTUP=True`):_ would overwrite manual UI edits on every recreation. Rejected: user-created state must survive recreations.

### Consequences and Trade-offs

**Positive**

- Zero-manual-step PostgreSQL access after `pnpm docker:app:dev`: login → the "Neo Bank Development PostgreSQL" server is registered and connects.
- Strictly development-only: production Compose files, images, and configuration are unchanged; the UI is loopback-only.
- One credential source: the registered server uses the exact `POSTGRES_*` values the `postgres` service runs with.
- Alloy (ADR-022) collects the container's stdout automatically — no extra wiring.

**Negative**

- One additional development container (~500 MB image, moderate Python memory footprint).
- The entrypoint override and the two mounted files are custom surface to maintain across pgAdmin upgrades.
- If `POSTGRES_PASSWORD` rotates, pgAdmin's stored connection password goes stale until the definition is re-rendered or re-entered (documented troubleshooting).
- `PGADMIN_CONFIG_MASTER_PASSWORD_REQUIRED=False` matters only on fresh setups: switching the setting later clears saved passwords (pgAdmin semantics).

### Security Assessment

Development-only exposure: the UI is bound to `127.0.0.1` and never defined in production Compose files; the initial administrator credentials are required interpolation values kept out of tracked files, and no real credential literals are committed anywhere. Authentication stays enabled (no `PGADMIN_CONFIG_*` bypass of login). The rendered `servers.json` is transient container-local scratch (`/tmp`) and never reaches tracked files; pgAdmin persists the imported connection password inside its configuration database on the `pgadmin_data` volume by design (development-only credentials; deleting the volume purges them). No privileged mode, no added capabilities, both mounts read-only. PostgreSQL reachability is unchanged: containers already share the compose network, and the host-side port binding is untouched.

### Operational Implications

- Start/stop with the existing dev-stack commands (`pnpm docker:app:dev` / `docker:app:dev:down`); pgAdmin is reachable at `http://localhost:5050` (default `PGADMIN_PORT`).
- Troubleshooting: a failed render (missing `POSTGRES_*` variable) aborts startup with an explicit error; a stale password after a `POSTGRES_PASSWORD` change is fixed by recreating the container (fresh definitions only load on a fresh volume) or re-entering the password in the UI.
- The dev orchestrator (`docker/compose.yml`) includes the dev app stack unchanged, so `pnpm docker:dev` brings pgAdmin up as well.

### References

- `docker/compose.app.dev.yml` (pgadmin service, pgadmin_data volume), `docker/pgadmin/` (servers.json.template, render_servers.py), `docker/env/.env.docker.example` (PGADMIN_PORT, PGADMIN_DEFAULT_EMAIL, PGADMIN_DEFAULT_PASSWORD)
- `docs/docker.md` (pgAdmin section, ports table), `docs/current-state.md` (infrastructure list)
- Related ADRs: ADR-020 (Redis Insight precedent), ADR-022 (Alloy log collection), ADR-024 (development-only service precedent), ADR-027 (PostgreSQL in the stack)
- Official documentation: https://www.pgadmin.org/docs/pgadmin4/latest/container_deployment.html, image: https://hub.docker.com/r/dpage/pgadmin4, upstream env-substitution gap: https://github.com/pgadmin-org/pgadmin4/issues/8663
- `prompts/_044-pgadmin-dev-infrastructure.md`

---

## ADR-029: Shared MikroORM BaseEntity with Actor Audit Context and Native Optimistic Locking

- **Status:** Accepted
- **Date:** 2026-11-15

### Context

ADR-027 established the MikroORM v7 + PostgreSQL persistence layer as infrastructure only: zero entities, zero migrations, zero tables. Every future entity needs the same shared persistence columns — primary key, creation/update timestamps, audit attribution, a concurrency version, and a future soft-delete timestamp — before the first table exists. Establishing the convention now means the first feature migration is born consistent; retrofitting later would require data backfill and destructive schema surgery. Additionally, no request-context or actor-identity mechanism exists (no authentication has landed), so audit attribution needs an isolated, minimal mechanism that yields `NULL` (system semantics) until identity arrives. All required ORM capabilities were verified against the exact installed sources (core/decorators/postgresql/sql 7.2.9, nestjs 7.1.0) before this decision: `@MappedSuperclass` no longer exists in v7 (the equivalent is `@Entity({ abstract: true })` — abstract entities are inlined into children during discovery), `BigIntType` syncs its runtime mode from the declared TypeScript `string` type, single numeric primary keys default to autoincrement (`bigserial`), `onCreate`/`onUpdate` property callbacks run exactly on create/real-update changesets, `@Property({ version: true })` atoms `version = version + 1` into the UPDATE SQL with the old version in the WHERE clause, `em.lock(entity, LockMode.OPTIMISTIC, { lockVersion })` implements client-provided expected-version checks, and `defineBaseEntityProperties` propagates base-class checks/indexes/uniques to every concrete entity.

### Decision

Every API entity extends a shared abstract `BaseEntity` (`apps/api/src/shared/database/base.entity.ts`, decorated `@Entity({ abstract: true })` so it generates no table); feature entities never redefine its properties.

- **Primary key:** `id` is PostgreSQL `bigint` via `bigserial` (the verified v7 native default for a single numeric PK), typed as TypeScript `string` (`BigIntType` mode `'string'` — values beyond `Number.MAX_SAFE_INTEGER` stay exact). PostgreSQL has no unsigned integers; a propagated class-level `@Check` constraint (`id > 0`) preserves the positive-identifier invariant on every concrete table.
- **Timestamps:** `createdAt` (`@Property` with `onCreate` and a field initializer) is non-nullable and immutable through normal updates; `updatedAt` (`@Property({ onUpdate })`, initializer `null`) starts `NULL` and is bumped by the ORM only when a real update changeset exists — never initialized to `createdAt`, never manually assigned. All timestamps are `timestamptz(3)` (ADR-030).
- **Audit attribution:** `createdBy`/`updatedBy` are nullable `bigint` scalars (TypeScript `string | null`) with **no foreign keys and no ORM relations** — no Users table exists, and the columns must not imply one. Values are resolved centrally from an AsyncLocalStorage actor context (`apps/api/src/shared/actor-context/`): `createdBy` via the property `onCreate` callback (`getActorId()`), `updatedBy` via `onUpdate` (`NULL` means the system performed the operation). A global NestJS middleware opens the context per request; the actor-extraction seam returns `null` until authentication lands and will then read only the verified principal attached by the auth layer — never client-supplied DTO fields or raw request headers. Background work and system operations run without a context and produce `NULL` attribution by design.
- **Optimistic locking:** `version` uses `@Property({ version: true })` (initializer `1`) — MikroORM owns the increment (`version = version + 1` in the UPDATE statement, old version in the WHERE clause, `OptimisticLockError` on row-count mismatch). Application services never increment versions manually and never write a client's expected version onto the entity. When a feature's update workflow receives the client's expected version (a dedicated DTO field), it calls `await em.lock(entity, LockMode.OPTIMISTIC, { lockVersion: expectedVersion })` before mutating, and maps `OptimisticLockError` to the shared conflict response through `apps/api/src/shared/errors/optimistic-lock.mapper.ts` (`ErrorCode.VersionConflict`, HTTP 409, bilingual Problem Details per ADR-021).
- **Soft delete surface:** `deletedAt` is a nullable `timestamptz(3)` column only — no filters, subscribers, repository overrides, or restore flows (explicitly out of scope).
- **Scope:** all ordinary writes go through MikroORM's EntityManager/UnitOfWork; raw SQL write paths and bulk updates are out of scope for lifecycle guarantees. Test-only fixture entities may exist under `apps/api/test/` and are never registered in production discovery.

### Alternatives Considered

- _Per-entity field duplication:_ every feature declares its own `id`/timestamps/audit columns. Rejected: guaranteed drift, exactly what a shared base prevents.
- _UUID primary keys:_ rejected — the requirement mandates BIGINT identifiers; no existing tables constrain the choice.
- _A `MappedSuperclass` decorator shim:_ does not exist in v7; `@Entity({ abstract: true })` is the verified equivalent.
- _Subscriber-based audit (global `subscribers` with `beforeCreate`/`beforeUpdate`):_ equally verified, but property-level `onCreate`/`onUpdate` callbacks achieve identical semantics with less machinery and stay co-located with the fields.
- _`GENERATED BY DEFAULT AS IDENTITY` instead of `bigserial`:_ PostgreSQL-modern, but in 7.2.9 it is reachable only through the column-metadata `generated` option used for computed columns — undocumented as an entity-level PK API. `bigserial` is the platform's verified native path.
- _Database triggers for auditing/versioning:_ rejected — duplicates ORM responsibilities the prompt and ADR-027 delegate to the Unit of Work.
- _`@nestjs/cls` dependency:_ rejected — a ~15-line `AsyncLocalStorage` module covers the need; no extra dependency for the same behavior.

### Consequences and Trade-offs

**Positive**

- Every table is born with consistent PK, timestamp, audit, version, and soft-delete-surface columns; the first feature migration carries them at birth.
- Concurrent updates cannot silently overwrite each other; conflicts surface as a stable, bilingual 409 contract.
- Actor context is request-isolated, works for system/background operations (NULL attribution), and is ready for authentication to fill the seam.
- No new dependency; no new environment variables; no schema synchronization.

**Negative**

- BIGINT identifiers surface as strings in serialization (deliberate, matches the BIGINT requirement).
- Audit columns are unenforced scalar values (no FK, no Users table) — correctness rests on the actor-context convention, not the database.
- Property lifecycle callbacks fire only through the standard Unit of Work: raw SQL and bulk-update write paths bypass them (documented out of scope).
- No-op updates skip `updatedAt`/`updatedBy` entirely (no changeset — verified ORM behavior; acceptable).
- Test-only fixture entities require the base entity listed explicitly when the `entities` option is used in test overrides.

### Security Assessment

Actor IDs never originate from client input: the extraction seam resolves only the verified principal once authentication exists, and until then everything is attributed to the system (`NULL`). Version conflicts are surfaced through the centralized exception architecture with a generic, localized message — the response distinguishes only "conflict", never internal state (current version is not disclosed beyond the 409 code). The `id > 0` check documents the positive-identifier invariant without exposing attack surface. No secrets, credentials, or internal identifiers appear in the new response paths.

### Operational Implications

- No startup-behavior change: the database module, connection resilience, and health semantics are untouched.
- The first real feature entity generates the first migration carrying all base columns; migrations remain the only schema path (ADR-027).
- `discovery.warnWhenNoEntities: false` stays until the first production entity lands (runtime still discovers zero entities; test fixtures are supplied explicitly through test overrides).

### References

- `apps/api/src/shared/database/base.entity.ts`, `apps/api/src/shared/actor-context/`, `apps/api/src/shared/errors/optimistic-lock.mapper.ts`, `apps/api/src/shared/errors/error.code.ts`, `apps/api/src/shared/database/mikro-orm.options.ts`, `apps/api/src/modules/app/app.module.ts`
- `docs/utc-datetime.md` (UTC policy details), DECISIONS.md ADR-021 (bilingual errors), ADR-027 (persistence layer)
- Verified installed sources: `@mikro-orm/core` 7.2.9 `MetadataDiscovery.js` (abstract inlining, BigIntType mode sync, base property/check propagation, version defaults), `unit-of-work/ChangeSetComputer.js` (`onCreate`/`onUpdate`), `unit-of-work/ChangeSetPersister.js` (versioned WHERE + `OptimisticLockError`), `@mikro-orm/sql` `AbstractSqlDriver.js` (atomic `version + 1`)
- Official documentation: https://mikro-orm.io/docs/defining-entities, https://mikro-orm.io/docs/transactions#optimistic-locking, https://mikro-orm.io/docs/usage-with-nestjs
- `prompts/_047-shared-base-entity.md`

---

## ADR-030: UTC-First TIMESTAMPTZ Storage Policy

- **Status:** Accepted
- **Date:** 2026-11-15

### Context

The API has no timezone policy anywhere — no `TZ`/`PGTZ`/`timezone` configuration exists in the Compose stacks, the environment files, the ORM configuration, or the documentation. The API serves users across two locales and arbitrary user timezones (Persian-speaking users primarily in `Asia/Tehran`, +03:30). Timestamps stored without an absolute-instant policy invite the classic failure class: local-time-as-UTC writes, ambiguous range queries across DST transitions, and display code that silently shifts instants. PostgreSQL `timestamptz` stores absolute instants (UTC internally) regardless of the client-supplied offset, which makes it the correct column type; the session timezone only affects rendering, so pinning the server container to UTC makes stored values, logs, and driver round-trips consistent. Verified installed-version facts: MikroORM 7.2.9 maps `Date` properties to `timestamptz` by default (precision 6 = microseconds) and `forceUtcTimezone` (default `true`) affects only timezone-less columns (`timestamp`) by forcing UTC serialization; the `pg` driver returns timestamp values as raw strings which the ORM hydrates using the platform timezone; the driver issues no session `SET TIME ZONE`, so the server's `TimeZone` setting governs.

### Decision

The application follows a UTC-first storage policy, documented in `docs/utc-datetime.md`:

- **Storage:** every application timestamp column uses PostgreSQL `timestamptz` with precision 3 (`timestamptz(3)`) wherever JavaScript `Date` is the canonical representation — `Date` carries exactly millisecond resolution, so higher precision is dead weight. `timestamp` (without timezone) is never introduced.
- **ORM configuration:** `forceUtcTimezone: true` is set explicitly in the shared MikroORM options (verified supported in 7.2.9; it also documents intent — the setting is the installed default).
- **Docker:** the PostgreSQL containers (dev, prod, and the Testcontainers test image) run pinned to UTC via `TZ: UTC`, so `initdb` writes `TimeZone = UTC` and `SHOW TimeZone` returns UTC. The API container sets no `TZ` — JavaScript `Date` is an absolute instant and Node's local zone must not influence persistence.
- **Application handling:** timestamps are `Date` instances treated as absolute instants; serialization uses ISO-8601 UTC representations; no code constructs shifted "local" dates or stores offsets in place of timezone identifiers.
- **Presentation boundary:** conversion to a user's timezone happens outside the persistence layer, using IANA identifiers (`Asia/Tehran`), via `Intl.DateTimeFormat` (no new date dependency). Calendar-day and range queries must derive UTC instants from the user's IANA zone boundaries — a local calendar day is not always 24 hours (DST), so `apps/api/src/shared/datetime/utc-datetime.ts` provides `calendarDayUtcRange(localDate, timeZone)` computing the exact UTC start/end instants from zone offsets, never fixed hour math.

### Alternatives Considered

- _`timestamp` (without timezone) + application-level UTC normalization:_ rejected — loses instant semantics at the database level and relies on every writer being perpetually correct.
- _Storing offsets alongside timestamps:_ rejected — an offset is not a timezone; DST transitions make static offsets wrong within the same zone.
- _A date/time library (Luxon, dayjs, date-fns-tz):_ rejected — `Intl.DateTimeFormat` covers zone-offset resolution natively; no dependency for the same behavior (the dependency-evaluation threshold applies).
- _Pinning the API container's `TZ` instead of PostgreSQL's:_ rejected per the verified behavior — the API's local zone does not affect `Date` instants; the server's `TimeZone` is the lever that actually controls rendering and driver round-trips.

### Consequences and Trade-offs

**Positive**

- Stored values are unambiguous absolute instants; range queries, ordering, and comparisons are correct by construction.
- One pinned timezone across dev/prod/test makes behavior and logs identical everywhere; `SHOW TimeZone` is verifiable in integration tests.
- Presentation conversion stays a per-feature concern with a documented, dependency-free pattern.

**Negative**

- `timestamptz` discards the original submission offset (by design — the absolute instant is the record of truth).
- Presentation code must correctly use the IANA-zone boundary helper; nothing in the type system enforces it (documented + reviewed).
- `calendarDayUtcRange` resolves offsets via `Intl`, so zones with gaps at local midnight (rare DST transitions) resolve to the next existing local instant — documented behavior.

### Security Assessment

No security-relevant surface: no secrets, no user input in the boundary math beyond a validated IANA identifier (invalid zone identifiers throw from `Intl` rather than silently shifting). Storing absolute instants prevents timestamp-based ambiguity attacks against audit and rate-limiting windows.

### Performance Implications

`timestamptz(3)` occupies the same 8 bytes as `timestamptz(6)`; `Intl.DateTimeFormat` instantiation in the boundary helper is confined to presentation-time range computations, not the persistence hot path.

### Operational Implications

- `TZ: UTC` applies to both Compose stacks and the test image; existing named volumes predate the pin but were already UTC (the image default), so no re-initialization is needed — the `SHOW TimeZone` integration test verifies the effective value.
- No new environment variables; no changes to connection resilience or health checks.

### References

- `docs/utc-datetime.md`, `apps/api/src/shared/database/mikro-orm.options.ts` (`forceUtcTimezone`), `apps/api/src/shared/datetime/utc-datetime.ts`, `docker/compose.app.dev.yml` / `docker/compose.app.prod.yml` (postgres `TZ`), `apps/api/test/testcontainers.ts`
- DECISIONS.md ADR-027 (persistence layer), ADR-029 (BaseEntity timestamps)
- Verified installed sources: `@mikro-orm/core` 7.2.9 `utils/Configuration.js` (`forceUtcTimezone` default), `platforms/Platform.js` (timezone → `'Z'`), `@mikro-orm/sql` `BasePostgreSqlPlatform.js` (`timestamptz` declaration, precision), `dialects/postgresql/typeOverrides.js` (raw-string timestamp handling)
- PostgreSQL documentation: https://www.postgresql.org/docs/17/datatype-datetime.html
- `prompts/_047-shared-base-entity.md`

---

## ADR-031: Use nestjs-cls for the Application Actor Context

- **Status:** Accepted
- **Date:** 2026-11-15

### Context

ADR-029 introduced a per-request actor context for audit attribution: a module-level `AsyncLocalStorage` singleton in `src/shared/actor-context/`, opened by a bespoke global Nest middleware, read by the BaseEntity audit callbacks through a plain exported function. The design deviated deliberately from the officially documented NestJS AsyncLocalStorage pattern (docs.nestjs.com/recipes/async-local-storage), which registers the ALS instance as a provider in a dedicated module and initializes the context with `AsyncLocalStorage.run()` in middleware — because the ORM's property lifecycle callbacks run inside the Unit of Work with no DI container access. That deviation costs DI-integration: store consumers cannot inject the store, unit tests cannot substitute it through the testing module, and the non-DI seam is bespoke. The official recipe explicitly names `nestjs-cls` as the ready-made alternative ("typed store, `cls.get()`/`cls.set()`, … easy testing"), and the developer directs its adoption for better ALS integration.

The constraint that drove the deviation still holds, so the selected library must serve both worlds: DI consumers and non-DI ORM callbacks. Verified against the released package (7.0.2, inspected): `ClsService` wraps a plain `AsyncLocalStorage` with `run()`-based initialization by default; `ClsMiddleware` is a standard Nest middleware (the same adapter-agnostic pipeline this repository already proves under Fastify — `MikroOrmMiddleware` and the bespoke actor middleware run through it); `ClsServiceManager.getClsService()` is a public, documented API for retrieving the `ClsService` outside Nest's DI — the exact seam the ORM callbacks need. MikroORM's own `RequestContext` (enabled by default via `@mikro-orm/nestjs`, verified in the installed source: `MikroOrmCoreModule.configure` registers `MikroOrmMiddleware` unless `registerRequestContext === false`; `RequestContext.create` forks a per-request `EntityManager` through its own ALS) is a separate mechanism with a separate responsibility — EM/Identity-Map isolation — and is not touched by this decision.

### Decision

Adopt **`nestjs-cls` 7.0.2** as the application's request-context ALS layer (dependency-evaluation skill completed: MIT, zero runtime dependencies, peer deps `@nestjs/core|common >= 10 < 13` covering Nest 12 on Node 24 with an ESM build, OSV query clean for 7.0.2, no consumer-side install scripts, active maintenance — released 2026-09-24).

- `src/shared/actor-context/` becomes a thin typed facade over the CLS service: the store stays `{ actorId: string | null }` (no God object — the NestJS docs' caution about implicit-context breadth applies), exposed through `ActorContextModule` which configures `ClsModule.forRoot` with `ClsMiddleware` (global, mounted, `run()`-based) and a `setup` hook that populates the store from the same actor-extraction seam (returns `null` until authentication lands; actor IDs never come from client input — ADR-029's trust boundary is unchanged).
- `getActorId()`/`getActorContext()` remain the single read surface; internally they bridge to `ClsServiceManager.getClsService()` so non-DI consumers (BaseEntity audit callbacks, background jobs) keep working unchanged. `runWithActorContext` delegates to the CLS service's `run()` for tests and background work.
- The bespoke `ActorContextMiddleware` is deleted; the library middleware replaces it.
- **MikroORM RequestContext stays separate and enabled:** the application ALS propagates application-level request metadata (actor attribution); MikroORM's automatic per-request fork isolates the EntityManager and Identity Map. Neither replaces the other, no EntityManager is stored in the application store, and no manual `RequestContext.create()` is added for ordinary HTTP requests.
- Fastify participates unchanged: `ClsMiddleware` runs through the Nest middleware pipeline ahead of guards/interceptors/handlers, exactly like the middleware it replaces; the Fastify adapter and bootstrap configuration are untouched.

### Options Considered

- _Keep the bespoke module-level ALS singleton (status quo):_ works and passed both review gates, but outside the documented DI pattern, with a bespoke non-DI seam and no typed-store/test ergonomics.
- _Native NestJS DIY pattern (recipe verbatim):_ DI-integrated, but every ergonomics feature (typed store plumbing, runWith test helper, non-DI manager) would be hand-maintained — duplicating what `nestjs-cls` ships; the recipe itself defers to ready-made options when a store is needed outside HTTP-only middleware scope.
- _`@nestjs/observe` TracerService:_ requires the Observe instrumentation setup; not a fit for a minimal typed actor store.

### Rationale

Developer direction plus the official recipe's endorsement of `nestjs-cls` for exactly this role; DI integration for future store consumers; upstream-maintained non-DI seam replacing our bespoke singleton; zero transitive dependencies; peers covering the installed stack. The library's further features (proxy providers, plugins) are unused now (YAGNI) and remain the growth path if request-context needs expand.

### Security Assessment

OSV query for `nestjs-cls@7.0.2`: 0 advisories. Package ships no consumer-side install scripts and has no runtime dependencies (no transitive supply-chain surface). License MIT. Verified by inspecting the published package contents (ESM/CJS builds, `ClsService` over native `AsyncLocalStorage`). The trust boundary is unchanged: the store is populated only from the actor-extraction seam (constant `null` until authentication); `saveReq`/`saveRes` stay off so raw request/response objects are not retained in the store. `pnpm audit` re-runs as part of the implementation. Not verifiable at decision time: upstream documentation makes no Fastify-specific compatibility statement — the mechanism relies on the adapter-agnostic Nest middleware pipeline, which this repository already exercises under Fastify.

### Consequences and Trade-offs

**Positive**

- Conforms to the documented NestJS pattern (module-owned ALS, middleware `run()` initialization, injectable store access).
- Typed store with injected access for future consumers; mockable `ClsService` and `runWith` in unit tests.
- Removes bespoke middleware and the bespoke non-DI manager in favor of maintained upstream APIs.

**Negative**

- One more dependency with its own release cadence; peer range `@nestjs/* >= 10 < 13` means a future Nest 13 upgrade needs a compatible `nestjs-cls` release.
- `getActorId()` now transitively depends on the library's global service manager.

**Limitations**

- Actor attribution stays `NULL` (system) until authentication lands.
- The store must stay minimal — only genuinely useful request metadata may enter (implicit-context God-object caution from the official docs).

### References

- `apps/api/src/shared/actor-context/` (module, bridge), `apps/api/src/modules/app/app.module.ts`, `apps/api/package.json`
- DECISIONS.md ADR-029 (actor context architecture — refined by this decision, mechanism only), ADR-027 (MikroORM RequestContext separation)
- Official documentation: https://docs.nestjs.com/recipes/async-local-storage, https://papooch.github.io/nestjs-cls/, https://mikro-orm.io/docs/identity-map, https://mikro-orm.io/docs/usage-with-nestjs
- Verified installed sources: `@mikro-orm/nestjs` 7.1.0 `mikro-orm-core.module.js` (automatic middleware registration), `mikro-orm.middleware.js` (`RequestContext.create`), `@mikro-orm/core` 7.2.9 `utils/RequestContext.js` (ALS run + per-request fork)
- `prompts/_048-nestjs-cls-actor-context.md`

---

## ADR-032: Migrate the API HTTP Platform from Fastify to the NestJS NodeAdapter

- **Status:** Accepted
- **Date:** 2026-11-15

### Context

ADR-002 adopted Fastify as the NestJS HTTP platform when NestJS offered no alternative beyond Express. NestJS 12.3 introduced the official `NodeAdapter` (`@nestjs/platform-node`): a first-party HTTP adapter built directly on `node:http`/`node:https` with no framework in between, becoming the default platform in NestJS 13. The API runs `@nestjs/core`/`common` 12.5.0, so the adapter is available without a major-version upgrade. Continuing on Fastify means carrying a framework dependency that upstream no longer treats as the strategic default, while `NodeAdapter` shrinks the dependency surface to the Node standard library and aligns the stack with the direction of the framework.

The migration is constrained by observable-behavior preservation: the API's contracts (ADR-005 URI versioning, ADR-006 body limit, ADR-007 global prefix, ADR-010 request IDs, ADR-011 response envelope, ADR-014 Swagger, ADR-015 throttling, ADR-021 i18n, ADR-031 actor context) must survive the adapter swap, and every deviation must be a recorded decision, not a silent test relaxation.

### Decision

Replace `@nestjs/platform-fastify` with `@nestjs/platform-node` 12.5.0 (`NodeAdapter`, `NestNodeApplication`) in the production bootstrap (`apps/api/src/main.ts`) and in every test application factory (`apps/api/test/create-test-app.ts` and the db-spec factories), which always pass the adapter explicitly so no test tier can silently initialize on a different platform. Remove `fastify` (dev dependency, types only) and `@fastify/static` (present solely for the Swagger UI on Fastify) once nothing imports them. Establish platform independence as a permanent architectural rule in the root `AGENTS.md` (the Platform-Agnostic Architecture section), and confine platform-specific code to the bootstrap boundary: every `src/` import of a Fastify type is replaced with Nest abstractions (`ExecutionContext`, `ArgumentsHost`) or app-owned minimal contracts, and platform-specific operations are isolated in the HTTP layer.

Behavior-critical mappings, verified against the installed adapter source and published type definitions:

- **Trust proxy:** `NodeAdapterOptions.trustProxy` accepts the same values as Fastify's option and compiles them with the same `proxy-addr` semantics; `req.ip`, `req.ips`, `req.protocol`, `req.hostname` resolve express-style from `X-Forwarded-*` for trusted proxies. `TRUST_PROXY` env configuration and the ADR-015 throttler tracker (`req.ip`) carry over unchanged.
- **Body limit:** the adapter's default body-parser limit is 100 KB, not Fastify's 1 MiB. Bootstrap registers `json` and `urlencoded` parsers explicitly through `useBodyParser` with `limit` taken from `BODY_LIMIT`, preserving ADR-006.
- **Request IDs (ADR-010):** Fastify's `genReqId` and raw `onRequest` lifecycle hook are replaced by the adapter's `setOnRequestHook` (runs as the first middleware; the adapter also runs it for the requests its router rejects before any middleware, as Fastify does for its own router errors). The hook assigns the request ID onto the request object, echoes `x-request-id` on every response, and rejects a present-but-invalid inbound header with 400 Problem Details exactly as before.
- **Root-level not-found fallback:** Nest core mounts its not-found handler only under the global prefix, so unmatched paths outside it (e.g. `GET /healthz`) would receive the adapter's plain-text 404 instead of the Problem Details contract that Fastify served instance-wide. The developer directed that the Problem Details contract be kept everywhere; the bootstrap therefore registers an additional prefix-less not-found fallback after init (implementation recorded in `docs/ai-decisions.md` §13), reusing the same shared building blocks as the Problem Details filter.
- **Swagger UI:** `SwaggerModule.serveStatic` checks the adapter type; for `node` it falls through to `app.useStaticAssets`, which `NodeAdapter` implements natively. `/docs`, `/docs/json`, `/docs/yaml` paths are unchanged, and `@fastify/static` is removable.
- **Actor context (ADR-031):** `nestjs-cls` detects the adapter by constructor name; non-Fastify resolves to the Express path, mounting `ClsMiddleware` at `/`. `NodeAdapter` supports connect-style middleware, so the CLS middleware runs in the same pipeline position. Correctness is verified by the existing actor-context e2e/db suites before sign-off.

**Accepted behavior changes** (Fastify-only behaviors the adapter does not reproduce; both are invisible to the current test suite and to clients of the current API):

- **No automatic ETag/304 support (restored in-task, 2026-11-15).** Fastify emits ETags on JSON responses and answers `If-None-Match` with 304; `NodeAdapter` does neither by default. The loss was accepted at migration time and recorded in `DEFERRED.md`; the developer then directed restoring it in the same task: a global `ConditionalRequestInterceptor` plus shared helpers tag every JSON-serializable response with a WEAK entity tag over the application payload (`W/"<sha256>"` — the response envelope adds per-response metadata, so byte-identity of the wire body is not claimed; `If-None-Match` compares weakly per RFC 9110 §13.1.2) and answer matching `If-None-Match` on GET/HEAD with 304 (the adapter ends 304s body-less natively). Problem Details responses and the two bootstrap error paths are tagged through the filter/helpers; their fresh timestamp/request IDs mean they never revalidate, matching the Fastify-era behavior.

A notable asymmetry in the other direction: Fastify's tags were STRONG and covered the full response envelope, whose fresh timestamp and per-request request ID changed the body on every response — so under Fastify, `If-None-Match` revalidation could never succeed for enveloped responses. The feature existed but had no usable effect. The weak payload validator restored here is the first implementation of this contract on the API where conditional revalidation actually works: "unchanged" means _same application data_ (the envelope's per-response metadata is deliberately excluded), which is the semantics clients caching representations want.

- **Keep-alive timeout explicitly set to 20 seconds** (`keepAliveTimeout = 20_000`, a named bootstrap constant). Fastify's default is 72 s, the raw Node default is 5 s; the developer chose 20 s as a deliberate middle ground. With no reverse proxy in front of the API today, neither value creates a compatibility problem; if a connection-pooling proxy lands, this is a one-constant change. The request timeout is accepted at the adapter's (Node's) 300 s default — Fastify disabled it entirely; nothing today serves a 5-minute response (2026-11-15, developer decision).
- **Proxy trust allowlist:** `TRUST_PROXY` keeps its boolean semantics and the new optional `TRUST_PROXY_PROXIES` variable (comma-separated proxy addresses or CIDR ranges) narrows trust to the listed proxies when `TRUST_PROXY=true`, removing the trust-all footgun for XFF-appending proxies (2026-11-15, developer decision — Wave 18 SEC-01).

### Alternatives Considered

- _Stay on Fastify (status quo):_ zero migration cost, but keeps a heavier dependency surface and diverges from the platform NestJS 13 makes the default; the platform-agnosticism rule would land regardless.
- _Express adapter (`@nestjs/platform-express`):_ the long-standing alternative, but a larger dependency tree, not the upstream default going forward, and its API surface invites Express-coupled code; explicitly rejected by the developer.
- _Defer to NestJS 13:_ bundles the platform swap into a major-version upgrade — a bigger, riskier change; rejected in favor of decoupling the two upgrades.

### Rationale

Developer direction. `NodeAdapter` is the official first-party adapter, eliminates the Fastify dependency from the runtime tree, and its option surface covers everything this API actually uses (trust proxy, body parsing, request hooks, static assets, CORS, middleware). The platform-agnosticism rule turns the migration's refactoring into a permanent constraint, so the next platform change is a bootstrap-file edit rather than a codebase sweep.

### Security Assessment

Trust-proxy semantics are identical (same `proxy-addr` compilation), so no new `X-Forwarded-*` spoofing surface. The 1 MiB body limit is enforced explicitly rather than inherited from Fastify defaults. Both Fastify's and the adapter's JSON parsers reject prototype-pollution keys (`__proto__`, `constructor.prototype`) with 400 by default. Error responses keep their generic Problem Details shape (existing filters unchanged in semantics). The supply-chain surface shrinks: `@nestjs/platform-fastify`, `fastify` (with its transitive tree), and `@fastify/static` are removed; `@nestjs/platform-node` brings `light-my-request` (test-injection) as its notable dependency. `pnpm audit` re-runs as part of implementation; OSV/advisory results are recorded there.

### Performance Implications

The radix-tree router and `node:http` serving are comparable to Fastify in throughput for this workload. The main regression: Fastify compiles response serializers (`fast-json-stringify`) while the adapter serializes with `JSON.stringify` — a constant-factor cost irrelevant at the current scale. No ETag generation also removes a per-response hash computation Fastify performed.

### Operational Implications

Docker images, Compose stacks, health checks, and the observability pipeline are adapter-agnostic and unchanged. Graceful shutdown carries over: the adapter tracks open connections and drains them on `close()` behind the existing `enableShutdownHooks()` path. Keep-alive is now explicit (20 s) instead of a framework default. Logging (`nestjs-pino`) already types against `IncomingMessage`/`ServerResponse`, so log shape and redaction are unchanged.

### Consequences and Trade-offs

**Positive**

- Runtime dependency on Fastify and its plugin tree removed; HTTP platform is the Node standard library plus first-party Nest code.
- Aligns with the NestJS 13 default platform, reducing future upgrade risk.
- Platform-agnosticism rule (`AGENTS.md`) makes reusable components adapter-neutral by construction.

**Negative**

- Lost framework conveniences: compiled JSON serialization, automatic ETags (deferred to `DEFERRED.md`), Fastify's strict header validation edge cases.
- Keep-alive is now an application-owned constant that must be revisited if a proxy with idle pooling is introduced.

**Limitations**

- `nestjs-cls` and `@nestjs/swagger` resolve the adapter by detection heuristics (`constructor.name`, `getType()`); a future adapter change must re-verify both.
- The adapter is young (12.3+); behavioral edge cases may surface that Fastify hardened over years — regression tests added in this migration are the guard.

### Testing and Migration Implications

- Baseline checks are recorded before any code change (build, lint, typecheck, unit, e2e, redis, db tiers).
- `test/create-test-app.ts` and the db-spec factories pass `new NodeAdapter()` explicitly; e2e assertions preserved semantically — `http-config` (body limit, trust-proxy identity), `envelope` (HEAD semantics), `request-id`, `rate-limit` — with Fastify-specific mechanics replaced.
- Regression tests are added for the two accepted behavior changes (no ETag; 20 s keep-alive) and for body-limit enforcement on the new parser chain.
- The GitNexus graph index re-analyzed after the migration to keep impact analysis accurate.

### References

- `apps/api/src/main.ts`, `apps/api/test/create-test-app.ts`, `apps/api/package.json`
- DECISIONS.md ADR-002 (superseded), ADR-005, ADR-006, ADR-007, ADR-010, ADR-011, ADR-014, ADR-015, ADR-021, ADR-025, ADR-031
- Official documentation: https://docs.nestjs.com/http/performance (NodeAdapter), https://docs.nestjs.com/fundamentals/platform-agnosticism
- Verified package sources: `@nestjs/platform-node` 12.5.0 published tarball (adapter, options, body parser, router), `@nestjs/swagger` 12.1.0 `swagger-module.js` (serve-static branch), `nestjs-cls` 7.0.2 `feature-detection.utils.js` (adapter detection, mount point)
- `DEFERRED.md` (ETag/304 conditional-request support), `prompts/_049-fastify-to-node-adapter.md`

---

## ADR-033: Immutable Migration Policy and Dedicated Migration Reviewer

- **Status:** Accepted
- **Date:** 2026-11-16

### Context

ADR-027 mandates that all PostgreSQL schema changes go exclusively through explicit SQL migrations generated with the MikroORM CLI (`pnpm db:migration:*`), never `schema:update` or `synchronize`. The generated migrations are reviewed before execution, but the review is ad hoc: no policy states whether an existing migration file may ever be modified, and no dedicated reviewer owns migration quality. Agent-driven development makes both gaps real risks — a later agent can "fix" a generated migration in place, silently diverging from what any applied environment recorded (MikroORM tracks executed migrations by name in `mikro_orm_migrations`), and nothing enforces the schema-level conventions (snake_case identifiers, no unexpected foreign keys, no data-loss operations) on every future migration.

### Decision

Two permanent governance rules, documented in the root `AGENTS.md`:

1. **Migrations are immutable.** An existing migration file is never edited, deleted, renamed, squashed, or rewritten — regardless of whether it has been executed. Every schema change, and every correction to an earlier migration's effects, is implemented as a **new forward migration** with an appropriate `down()` operation. A migration that needs correcting is never corrected in place.
2. **Dedicated migration reviewer.** A persistent, read-only `migration-reviewer` subagent joins the `.agents/` framework (canonical definition in `.agents/definitions/`, generated for ZCode and Claude Code by `scripts/agents/sync.mjs`, like `code-reviewer`). Every newly generated migration must pass its structured review (verdict `APPROVED` or `CHANGES REQUIRED`, with schema-change inventory, data-loss risks, naming/type violations, and required corrections) before the task is considered complete. Corrections required by the reviewer are made through new forward migrations, never by editing the reviewed file, and corrective migrations go through the same review.

### Options Considered

- _Status quo (ADR-027 only, ad hoc review):_ works for a hand-reviewed codebase, but gives agents no enforceable boundary and leaves history integrity to discipline.
- _Editable migrations until first production release:_ tempting pre-1.0, but MikroORM's migration bookkeeping makes edited files silently inconsistent with any environment that already ran them, and the "we have not shipped yet" exception erodes the moment the first dev database exists.
- _CI-only checksum guard (fail the build when a tracked migration changes):_ useful hardening later, but purely reactive — it detects the drift after the fact instead of preventing it, and does not review semantics (naming, data loss, unexpected constraints).

### Rationale

Forward-only history is the only mode consistent with MikroORM's name-based bookkeeping and with auditability requirements for a banking product. A dedicated reviewer (rather than extending `code-reviewer`) gives migrations their own SQL-focused checklist — inherited-column propagation, entity/table mapping, `up()`/`down()` symmetry — independent of general code quality review, and keeps the two review gates from blurring.

### Security Assessment

The immutability rule prevents an attack/mistake class where a migration is rewritten after review to introduce different SQL than what was audited. The reviewer explicitly screens for data-loss operations (`DROP`, destructive `ALTER`), unauthorized foreign keys, and schema changes outside the entity that motivated the migration. No secrets or credentials may appear in migration files (connection details come from the environment, never hardcoded).

### Performance Implications

None. Forward-only history grows linearly with real schema changes; the correction-on-top pattern adds occasional no-op migrations whose cost is negligible.

### Operational Implications

Environments apply migrations exclusively forward (`db:migration:up`); rollback uses the generated `down()` of the latest migration for development incidents, never file edits. Migration files and the Migrator snapshot are source-controlled artifacts and part of review scope.

### Testing and Migration Implications

Every migration is inspected line-by-line (`up()` and `down()`) before execution and reviewed by the `migration-reviewer` subagent. The migration is verified against the entity metadata (column names, types, nullability, constraints) and executed only against controlled development databases.

### References

- Root `AGENTS.md` (Database Governance section), `apps/api/AGENTS.md` (Database Rules)
- `.agents/definitions/migration-reviewer.md`, `.agents/README.md`, `scripts/agents/sync.mjs`
- DECISIONS.md ADR-027 (migration workflow this policy governs), ADR-023 (multi-agent framework the reviewer joins)
- `prompts/_051-mikroorm-database-lifecycle-enrollment-migration-governance.md`

---

## ADR-034: Database Connection Lifecycle Logging via the pg Pool

- **Status:** Accepted
- **Date:** 2026-11-16

### Context

PostgreSQL is the architecture-required startup dependency (ADR-027 amendment): the initial connection is established during bootstrap with bounded retries, and its success/failure is logged by `DatabaseConnectionInitializer`. After boot, connection-level events are invisible to the application's Pino logs. Verified against the installed MikroORM 7.2.9 sources: MikroORM exposes **no connection lifecycle event API** — no disconnect or reconnect events exist. The PostgreSQL driver's `PostgreSqlConnection` does expose the underlying `pg` Pool through the public, documented `getNativeClient()` accessor, and the driver internally registers pool/client `'error'` handlers through MikroORM's own logger (`handlePoolErrors` in `PostgreSqlConnection.js`) — a crash guard whose output is silent at the default (non-debug) logging configuration. The result: a server-dropped idle connection or a pool error degrades the service with nothing in the operator's log stream beyond the health indicators flipping.

### Decision

Add a `DatabaseLifecycleLogger` provider to `src/shared/database/`:

- Registered after `DatabaseConnectionInitializer` through a constructor dependency edge: Nest instantiates the initializer first, and because same-level bootstrap hooks run concurrently (a plain providers-array order is not sequencing), the DI edge is what makes the logger's `onApplicationBootstrap` run strictly after the bounded-retry boot connect has succeeded (plus an `orm.isConnected()` guard — the public `getNativeClient()` awaits `ensureConnection()` and must never be the caller that dials the database). _(Mechanism sentence amended 2026-11-16 during implementation — the decision itself is unchanged; see `docs/judge-findings.md` Wave 21 CR-01.)_
- Obtains the `pg` Pool through the public documented accessor (`orm.em.getConnection().getNativeClient()`) and attaches **pool-level** node-postgres events: `'connect'` (new physical connection; info) and `'error'` (idle-client/pool error; warn). `'acquire'`/`'release'` are skipped (per-query noise) and client-level events are left to the driver's internal handlers.
- Listeners log through the existing Pino-backed NestJS `Logger`, with no credentials, URLs, or connection parameters in messages.
- Registration is guarded against duplicates; listeners are removed via `pool.off(...)` in `beforeApplicationShutdown` — before `@mikro-orm/nestjs` closes the ORM in `onApplicationShutdown` — idempotently, so repeated shutdowns are safe and no handler outlives its owner.

No MikroORM configuration changes: the ORM keeps sole ownership of the connection lifecycle (no manual `close()`, no `reconnect()`). Known limitations, accepted: boot-time physical connections are not observed (the initializer already logs boot success explicitly), a pool `'error'` line may duplicate the driver's internal log when debug logging is enabled, and the pool instance is assumed stable for the process lifetime (true unless `orm.reconnect()` is called, which the application never does).

### Options Considered

- _Typed configuration hooks `onCreateConnection` / `onReserveConnection` (`Configuration.d.ts:153/159`):_ supported and typed, but the callback argument is `unknown` and `onReserveConnection` fires per acquisition (noise); neither surfaces pool-level errors.
- _`driverOptions.onPoolCreated` (consumed by `createKyselyDialect` in the installed driver):_ fires at pool creation (before boot connections), but is an untyped `Dictionary` pass-through — rejected in favor of the fully typed public accessor.
- _Health-indicator polling only (status quo):_ reports reachability but never the event detail (which connection failed, when the pool grew).
- _Do nothing:_ connection degradation stays invisible in logs; rejected — the operator surface is Pino/Loki, and the health endpoint alone does not explain degradation.

### Rationale

The pool-event approach uses only documented, public APIs — MikroORM's `getNativeClient()` contract ("for vendor APIs MikroORM does not wrap") plus node-postgres' own EventEmitter events — with full typing inferred from the accessor, no new dependency, no configuration surface, and no second logging mechanism. It fills precisely the gap the internal handlers leave: crash protection exists; operator visibility did not.

### Security Assessment

No credentials or connection URLs are logged — messages carry event names and pool counters only, and pg error messages (e.g. "Connection terminated unexpectedly") do not contain secrets. No new trust boundary: listeners observe events, never touch queries or transactions. No new dependency and no configuration change, so no new supply-chain surface.

### Performance Implications

Two listeners on an EventEmitter; `'connect'` fires only when the pool grows a physical connection and `'error'` only on failures — both rare, log emission cost negligible. No added queries, round trips, or allocations on the request path.

### Operational Implications

Connection growth and degradation become visible in the Pino stream (and therefore Loki, ADR-022). Graceful shutdown ordering is explicit: detach (`beforeApplicationShutdown`) precedes ORM close (`onApplicationShutdown`), so no handler fires during pool teardown.

### Testing and Migration Implications

Unit tests cover: listener registration after connect, `'connect'`/`'error'` log levels, duplicate-registration prevention, and idempotent cleanup (safe repeated shutdown). No migration impact (infrastructure-only change, no schema effect).

### References

- `apps/api/src/shared/database/database.lifecycle.ts`, `apps/api/src/shared/database/database.module.ts`
- Verified installed sources: `@mikro-orm/core` 7.2.9 `connections/Connection.d.ts` (`getNativeClient` contract), `@mikro-orm/postgresql` 7.2.9 `PostgreSqlConnection.js` (`handlePoolErrors`, dialect/pool creation), `@mikro-orm/core` `utils/Configuration.d.ts` (typed hook alternatives), `@mikro-orm/nestjs` 7.1.0 `mikro-orm-core.module.js` (close in `onApplicationShutdown`)
- node-postgres Pool events documentation: https://node-postgres.com/apis/pool#events
- DECISIONS.md ADR-027 (database integration ownership), ADR-008/009 (Pino logging)
- `prompts/_051-mikroorm-database-lifecycle-enrollment-migration-governance.md`
