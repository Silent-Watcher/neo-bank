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

- **Status:** Accepted
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

- `compose.dev.yml` (redis service), `.env.docker.example` (REDIS_INSIGHT_PORT), `apps/api/src/shared/http/startup-url.ts` and `apps/api/src/main.ts` (startup logging), `apps/api/src/shared/config/env/schema/server.env.ts` (optional REDIS_INSIGHT_URL)
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
