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
