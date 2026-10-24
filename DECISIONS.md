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
