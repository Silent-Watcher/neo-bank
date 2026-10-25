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

Nx provides a broader set of monorepo capabilities, including advanced project graph analysis, generators, plugins, and extensive task orchestration features.

However, its learning curve and breadth of capabilities introduce additional conceptual and configuration overhead that is not justified by the current project size or team structure.

For a single-developer project with three applications, these additional capabilities would add complexity without providing enough immediate value.

Nx may be reconsidered if the repository grows substantially or develops requirements that justify its additional capabilities.

#### Separate Repositories

Maintaining the API, web application, and admin dashboard in separate repositories would introduce additional coordination overhead and fragment the project context available to AI coding agents.

It would also make shared tooling and cross-application changes harder to manage consistently.

This approach was therefore rejected.

### Consequences

**Positive consequences**

- A unified development workflow across all applications.
- Shared repository-level tooling and conventions.
- Better context for AI-assisted development.
- Reduced redundant work through task caching.
- Dependency-aware and parallel task execution.
- A relatively small conceptual and maintenance footprint.

**Trade-offs**

- Applications share a repository and require clear workspace boundaries.
- Turborepo caching must be configured correctly to avoid stale or incorrect results.
- Shared tooling and root configuration require consistent maintenance.
- Remote caching, if introduced, requires additional setup and appropriate access controls.
- The project does not immediately benefit from some of Nx's advanced generators, project graph features, and plugin ecosystem.

### Reassessment Criteria

Reconsider this decision if:

- The team grows significantly.
- The number of applications and packages increases substantially.
- Advanced dependency graph analysis or code generation becomes a recurring requirement.
- Turborepo no longer satisfies the repository's orchestration or maintainability needs.
- The benefits of an alternative tool clearly outweigh its additional complexity.

### References

- [Turborepo Documentation](https://turborepo.com/docs)
- [Nx Documentation](https://nx.dev/docs)

## ADR-002: Adopt Fastify as the NestJS HTTP Platform

- **Status:** Accepted
- **Date:** 2026-10-24

### Context

The project targets high request rates per second and is still new, making this the ideal time to choose its HTTP platform. The API application (`apps/api`) currently runs NestJS on the default Express adapter with no Express-specific middleware or integrations in place, so a platform switch carries minimal migration cost today.

### Decision

Use Fastify instead of Express as the HTTP platform for the NestJS API, via `@nestjs/platform-fastify` and `FastifyAdapter`.

### Benefits

- Strong performance characteristics and a suitable foundation for high-throughput workloads.
- No Express-specific middleware must be ported at this time because none exists yet.

Actual performance improvements are not guaranteed and must be confirmed with benchmarks before being claimed.

### Alternatives Considered

#### Retain Express

Express is the most familiar Node.js framework and has the broadest middleware ecosystem.

Retaining it was rejected because the project's high-RPS target favors Fastify's performance characteristics, and the project is new enough that switching costs are minimal now and only grow later.

### Consequences

Fastify-compatible integrations and APIs must be used.

**Positive consequences**

- The API starts from a platform aligned with its high-throughput goals.

**Trade-offs**

- Lower familiarity among some developers.
- Incompatibility with certain Express middleware and tools; equivalent Fastify plugins or alternatives must be used when needed.

## ADR-003: Adopt SWC for TypeScript Compilation

- **Status:** Accepted
- **Date:** 2026-10-24

### Context

The NestJS CLI currently transpiles the API with the TypeScript compiler (`tsc`). Compilation speed directly affects the development feedback loop and rebuild times, and the project's ESM-first setup has no path aliases or compiler workarounds that depend on `tsc`-specific behavior.

### Decision

Use SWC for TypeScript transpilation in the NestJS CLI build (`"builder": "swc"` with a `.swcrc` configuration that preserves decorators, metadata, source maps, and the ESM module format).

### Benefits

- Faster compilation and recompilation, improving the development feedback loop.

### Alternatives Considered

#### Continue Using the TypeScript Compiler

`tsc` performs transpilation and semantic type checking in one step and requires no extra dependencies.

It was rejected as the transpiler because SWC transpiles significantly faster, and semantic type checking is preserved anyway through a separate explicit type-check step.

### Consequences

A compatible SWC configuration must be maintained, and type checking must stay explicit and separate because SWC transpilation does not perform semantic type checking.

**Positive consequences**

- Faster builds and watch-mode recompilation.

**Trade-offs**

- Additional development dependencies (`@swc/core`).
- A separate type-checking requirement (`tsc --noEmit`), which already exists as the `typecheck` script.
- SWC does not emit `.d.ts` declaration files; nothing currently consumes them in this private application.

## ADR-004: Use @nestjs/config and Zod for Configuration and Environment Validation

- **Status:** Pending
- **Date:** 2026-10-24

### Context

The API application needs its environment variables (`APP_ENV`, `HOST`, `PORT`, and future additions) to be defined, validated, and exposed to the application in a type-safe way. Runtime values arriving through `process.env` are always strings or `undefined`, so raw access is error-prone: an invalid port or an unknown environment name would otherwise surface only as a confusing runtime failure after the server has started.

### Decision

Use **`@nestjs/config`** together with **Zod** as the configuration and environment-validation foundation:

- Environment files are loaded by Node.js `--env-file` (via `NODE_OPTIONS` in the relevant scripts), not by NestJS ConfigModule; ConfigModule runs with `ignoreEnvFile: true`.
- Environment variables are validated at startup by a Zod aggregate schema (`src/shared/config/env/env.config.ts`) that parses `process.env` once — the only place in the codebase permitted to read `process.env`.
- The `AppEnv` enum (`src/shared/enums`) is reused directly inside the Zod schema, so the allowed application environments are defined exactly once.
- Validated values are exposed as the `_env` object and mapped into namespaced configuration factories via `registerAs` with symbol tokens (e.g. `SERVER_CONFIG`), registered through the central `ConfigModule.forRoot` setup in `src/shared/config/config.ts`.
- Consumers read configuration through `ConfigService` using the namespace symbol (e.g. `app.get(ConfigService).get<ServerConfig>(SERVER_CONFIG)`), never from `process.env`.
- Validation is fail-fast: on failure the process prints a readable, prettified Zod error (`z.prettifyError`) via the `EnvValidationError` error class and exits with code `1` before the server accepts requests. Zod's built-in error formatting is used instead of the additional `zod-validation-error` dependency, since Zod 4's `z.prettifyError` provides equivalent readable output.
- Direct `process.env` and `console.log` usage in source code is banned (enforced by the oxlint `no-process-env` and `no-console` rules, with a single exception for the validation layer).

### Alternatives Considered

#### ConfigModule-Managed `.env` Loading with Joi or class-validator

`@nestjs/config` natively supports `.env` file loading and schema validation with Joi or `class-validator`.

This was rejected because the project already uses Node.js `--env-file`-capable tooling, making ConfigModule's own file loading redundant; class-validator requires decorator boilerplate for a simple object schema; and Joi is an additional validation dependency that cannot reuse TypeScript enums directly the way Zod can (`z.enum(AppEnv)`).

#### Plain `process.env` Access with Manual Checks

Reading `process.env` directly and hand-writing guards is dependency-free.

It was rejected because it scatters validation logic, offers no type inference, and cannot guarantee fail-fast startup validation without duplicating checks at every consumer.

### Consequences

All environment variables must be declared in a Zod schema under `src/shared/config/env/schema/` and mapped through a namespaced configuration factory before any code can consume them.

**Positive consequences**

- Fail-fast startup with clear, human-readable validation errors.
- Fully typed configuration derived from the schemas.
- A single, auditable place where `process.env` is read.
- No duplicate definitions of allowed environment values, thanks to reusing the `AppEnv` enum in the schema.
- No extra formatting dependency for validation errors.

**Trade-offs**

- Zod and `@nestjs/config` are new runtime dependencies.
- New environment variables require touching a schema file and a configuration factory.
- Configuration consumers depend on `ConfigService` and the namespace symbols instead of reading values directly.

## ADR-005: Use URI-Based API Versioning

- **Status:** Pending
- **Date:** 2026-10-25

### Context

The API is in early development and currently serves every route unversioned. A versioning strategy should be established before meaningful endpoints accumulate, so that future breaking changes do not require retrofitting version identifiers onto an established public surface.

### Decision

Use NestJS URI versioning (`VersioningType.URI`) with `defaultVersion: '1'`, so controllers resolve under a `/v1` path segment (`/api/v1/...`) unless explicitly versioned otherwise. The health check route is version-neutral (`VERSION_NEUTRAL`), since infrastructure probes should not change shape when the API version changes.

### Benefits

- Version identifiers are visible in URLs: requests are self-describing, routing is explicit, and access logs, metrics, and debugging output show which version served each request.
- Simple for clients: a version change is a path change, with no reliance on custom headers or content negotiation.
- NestJS routes it natively, with no additional dependency or middleware.

### Alternatives Considered

#### Header-Based Versioning

A custom header (e.g. `Accept-Version`) keeps URLs clean but hides the version from logs and debugging output, requires clients to set non-standard headers, and complicates caching because the URL no longer uniquely identifies the response.

#### Media-Type Versioning

Encoding the version into the `Accept` header is the most HTTP-idiomatic option, but it is the hardest for clients to get right, the least visible operationally, and over-engineered for an API that currently has one version.

### Consequences

**Positive consequences**

- `/api/v1/...` routes are predictable and observable.
- New controllers default to v1 automatically via `defaultVersion`.
- The health check stays stable at `/health` regardless of API versions.

**Trade-offs**

- Version identifiers occupy the URL path.
- URI versioning implies resource-level versioning rather than fine-grained per-representation versioning.
- If clients or requirements later demand header-based negotiation, the strategy can be revisited while the API is still young.

## ADR-006: Configure a Maximum Request Body Size of 1 MiB

- **Status:** Pending
- **Date:** 2026-10-25

### Context

Fastify buffers request bodies for parsing. Without an explicit limit, the default applies, and any client can submit arbitrarily large payloads that the server must buffer before rejecting them, consuming memory proportional to request size. The API currently accepts only small JSON payloads, and there is no file-upload or bulk-ingestion feature that justifies large bodies.

### Decision

Configure a maximum request body size of **1 MiB (1048576 bytes)** as the default, applied through Fastify's `bodyLimit` adapter option. The limit is not hardcoded at the call site: it is provided by the `BODY_LIMIT` environment variable (a positive integer in bytes, validated at startup by the Zod environment schema) so each environment can override it without code changes. Requests exceeding the limit are rejected by Fastify with HTTP `413 Payload Too Large`.

### Benefits

- Bounds per-request memory consumption and reduces exposure to oversized-payload abuse.
- The default is sane for the current JSON-only API, while remaining environment-configurable.

### Alternatives Considered

#### Accepting the Fastify Default

Leaving `bodyLimit` unset would work today, but the effective limit would be implicit, undocumented, and not tied to the project's validated configuration mechanism.

#### A Smaller or Larger Fixed Limit

A fixed limit without an environment variable would force a code change whenever an environment needs a different maximum (e.g. an environment that introduces a legitimately larger endpoint later).

### Consequences

**Positive consequences**

- Explicit, validated, per-environment control of the maximum payload size.
- Deterministic `413` responses instead of unbounded buffering.

**Trade-offs**

- Legitimate requests larger than the configured limit are rejected; the limit must be raised deliberately if future endpoints (e.g. uploads) need more.
- One more environment variable to document and configure.

## ADR-007: Use a Global `api` Prefix with a `/health` Exception

- **Status:** Pending
- **Date:** 2026-10-25

### Context

The API currently registers routes at the server root (`/health`, and application endpoints at `/`). As the project grows toward serving both API consumers and potential non-API surfaces (docs, webhooks, infrastructure endpoints), an undifferentiated root namespace provides no separation between them.

### Decision

Apply the global prefix `api` to all API routes via `setGlobalPrefix`, combined with URI versioning (ADR-005) to produce the route structure `/api/v1/...`. The health check route is explicitly excluded from the prefix and remains at `/health`: it is a version-neutral infrastructure endpoint, and `VERSION_NEUTRAL` does not by itself remove a route from the global prefix, so the exclusion must be configured explicitly in the application bootstrap.

### Benefits

- API routes are separated from non-API routes, leaving the root namespace free for future non-API endpoints.
- Operational clarity: infrastructure tooling, load balancers, and humans can distinguish API traffic by path.
- The health endpoint stays at a stable, conventional location that probes can rely on regardless of API versioning decisions.

### Alternatives Considered

#### No Prefix

Keeping routes at the root is marginally shorter but mixes API and non-API namespaces and leaves no room for future root-level surfaces.

#### Versioned Health Check

Serving `/api/v1/health` would tie infrastructure probing to API versions, forcing probe configuration updates on every version bump for no operational benefit.

### Consequences

**Positive consequences**

- A clear, uniform route structure: `/api/v1/...` for the API, `/health` for probing.
- The `/health` exception is explicit and documented in the bootstrap code rather than accidental.

**Trade-offs**

- Every API path is slightly longer due to the `api` prefix.
- The health route requires an explicit exclusion that developers must remember to preserve when touching the application bootstrap.
