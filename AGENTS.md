# AGENTS.md

## Project Overview

This is a TypeScript monorepo managed with pnpm and Turborepo.

- `apps/api`: NestJS backend.
- `apps/web`: Next.js web application.
- `apps/admin`: React + Vite admin dashboard.
- `prompts/`: Feature records and implementation prompts.
- `docs/`: Repository-level architecture documentation.

## Neo Bank Business Domain

The product is a retail bank. Customer onboarding starts with a multi-step
Enrollment form, gated by phone-number OTP verification. An Enrollment is a
customer's onboarding application — it is not an active bank account and does
not establish an authenticated banking identity. After an Enrollment is
completed and (in a future workflow) approved, the customer gains access to
banking capabilities: opening and activating a bank account, receiving a bank
card, depositing funds, and performing banking operations.

### Enrollment Business Invariants

- **At most one non-expired Enrollment per normalized phone number.** The
  statuses `INITIAL`, `IN_PROGRESS`, `PENDING_REVIEW`, `REJECTED`, and
  `APPROVED` occupy the phone number; `EXPIRED` releases it. PostgreSQL must
  enforce this through a partial unique index on `phone_number`
  (`WHERE status <> 'EXPIRED'`) — application-level lookups alone cannot
  survive concurrent requests. This invariant supersedes the earlier
  developer rejection of phone-number uniqueness (2026-11-16) recorded in
  `DEFERRED.md` and `docs/judge-findings.md` (SEC-02).
- **Expiration.** Every new Enrollment carries a fixed expiration instant
  set at creation (target: creation time + 24 hours), never extended by
  later user activity. Only `INITIAL` and `IN_PROGRESS` can expire. An
  expired Enrollment remains stored as historical data and releases its
  phone number (and, once collected, national code and username); the
  customer may then start a new Enrollment with the same phone number.
- **Rejection.** A `REJECTED` Enrollment is not an opportunity to create a
  separate application — the customer is directed to correct the existing
  application through the future correction workflow. `APPROVED` must not be
  used to create another Enrollment unless an explicitly approved future
  banking-lifecycle policy says otherwise.

## Documentation and Context Management

- Read this root file first; it applies to every task in the repository.
- At the start of every session, read `PROJECT_CONTEXT.md` after this file. It
  is the initial architectural reference and documentation index: use it to
  understand the repository and decide which further documentation or source
  files a task needs, instead of exploring the repository broadly.
- Identify the application or package the task concerns before exploring the
  codebase, then read that workspace's nested `AGENTS.md` (for example
  `apps/api/AGENTS.md`) before changing its code.
- Consult `docs/architecture.md` when a task involves cross-application
  architecture or workspace boundaries.
- Consult `docs/current-state.md` before implementing functionality that
  might already exist, partially exist, or depend on an unfinished feature.
- Load context progressively: read only the documentation and source files
  the current task requires; specialized documents (`docs/docker.md`,
  `docs/ai-decisions.md`, `docs/observability/`,
  `docs/security-otp-enrollment.md`, ADRs) are read
  only when relevant. Prefer targeted searches over broad repository
  exploration, and do not re-read files whose contents are already available
  in the session unless they may have changed.
- Inspect only the source files relevant to the current task; do not read the
  entire repository unnecessarily.
- Never assume documentation is more accurate than the actual implementation;
  when they conflict, trust the code and flag the discrepancy.
- Update `PROJECT_CONTEXT.md` only when meaningful project-level information
  changes (architecture, boundaries, module responsibilities, major
  dependencies, infrastructure, the documentation set) — not for minor
  implementation or documentation edits.

### Code Intelligence (GitNexus)

The repository is indexed by GitNexus (see the "GitNexus — Code Intelligence"
section at the end of this file, including the mandatory impact/pre-commit
rules). Beyond those mandatory checks, use GitNexus as the first stop for any
navigation or comprehension question — it reaches the answer through the
dependency graph instead of broad text search:

- When you need to find something quickly or understand how the project
  works, prefer graph queries before sweeping the repository with grep/Glob:
  `query` for concepts and execution flows, `context` for a named symbol,
  `impact` for callers and blast radius.
- This applies to session setup too: `project-explorer` establishes the
  documentation baseline; GitNexus answers the code-structure questions
  ("where does X live, who calls it, how does flow Y execute") that the docs
  do not.
- When the GitNexus MCP tools are unavailable, use the CLI fallback:
  `node .gitnexus/run.cjs <command> --repo .` (see the resource table in the
  GitNexus section and the `gitnexus-*` skills for per-task workflows).
- Treat `risk: UNKNOWN` or an empty caller set as unresolved, not as unused:
  confirm with a text search before acting on it.

### Documentation Update Triggers

Documentation is part of the deliverable. Whenever a change matches a trigger
below, update the listed files **in the same task, before reporting
completion** — the same way code and tests are. Update only what the change
actually affects; do not rewrite unrelated content. If a documented fact
becomes stale during the task but cannot be corrected (unknown outcome,
pending decision), report it in the final summary instead of leaving it
silently wrong.

| Trigger (any change that…)                                                                                    | Files to update                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adds or changes an environment variable (API)                                                                 | `apps/api/env/.env.example` (with a comment), `apps/api/ONBOARDING.md` (env table)                                                                       |
| Adds, completes, or removes a feature or endpoint                                                             | `docs/current-state.md` (implemented/partial/planned lists)                                                                                              |
| Adds or changes shared infrastructure, response/error/validation conventions, or module structure conventions | `apps/api/AGENTS.md`                                                                                                                                     |
| Changes what a feature module looks like (new file layout, new required files)                                | `apps/api/AGENTS.md` + `apps/api/ONBOARDING.md` (project structure / workflow)                                                                           |
| Adds, removes, or renames a workspace (app or package)                                                        | `docs/architecture.md`, `docs/current-state.md`, `README.md` (applications table), and create `AGENTS.md` + `ONBOARDING.md` in the new workspace         |
| Adds or changes a dependency (in any workspace)                                                               | That workspace's `ONBOARDING.md` (technology stack table)                                                                                                |
| Adds, removes, or changes a script/command (workspace or root)                                                | That workspace's `ONBOARDING.md` (useful commands); root `README.md` for root-level scripts                                                              |
| Changes a port, default value, or runtime requirement (Node/pnpm versions)                                    | Root `README.md` and affected `ONBOARDING.md` files                                                                                                      |
| Creates, accepts, or supersedes an ADR                                                                        | `DECISIONS.md` (per its own workflow), `docs/current-state.md` (ADR status list), `docs/architecture.md` if a boundary or structure it describes changes |
| Changes a naming, coding, or testing convention                                                               | The affected workspace's `AGENTS.md`                                                                                                                     |
| Adds a new `#` import alias (API)                                                                             | No doc change needed (rule is documented generically), but keep `apps/api/package.json` and `apps/api/test/subpath-import-aliases.ts` in sync            |
| Makes any statement in `docs/architecture.md` or `docs/current-state.md` inaccurate                           | That file, immediately                                                                                                                                   |
| Changes project-level architecture facts, boundaries, major dependencies, or the repository documentation set | `PROJECT_CONTEXT.md` (only the affected section)                                                                                                         |

When a change matches no trigger, no documentation update is required — but
if you are unsure whether a change is "material", update rather than skip.

### Environment File Synchronization

**`.env.example` is the canonical reference for environment variable definitions and their documentation.**

Whenever an Agent creates, removes, renames, or modifies an environment variable in `.env.example`, it must inspect and synchronize all relevant environment files across the Monorepo.

This includes all applicable development, production, testing, and application-specific environment files.

#### Synchronization Rules

1. Keep the set of environment variable names consistent across the relevant environment files.
2. When a new variable is added to `.env.example`, add it to every applicable environment file.
3. When a variable is renamed, update every relevant reference and environment file.
4. When a variable is removed from `.env.example`, inspect its usages across the repository before removing it from other environment files.
5. When a variable's purpose or configuration requirements change, update its documentation consistently.
6. Never update `.env.example` without checking the remaining environment files.
7. Never assume that updating only one environment file is sufficient.

#### Environment Variable Stability

Existing environment variables and their populated values are stable project
configuration, not agent preferences. Future agents must:

1. Preserve existing environment variable names.
2. Preserve existing populated values; never overwrite a value because a
   different default would be preferred.
3. Never rename an existing variable without explicit developer approval.
4. Add new variables only when an actual implementation requires them.
5. Remove a variable only when it is genuinely obsolete; check its usages
   first and justify the removal.
6. Update all relevant environment files and validation schemas when adding
   or removing variables (see Synchronization Rules above).
7. Keep development, test, and production configurations consistent with
   their respective requirements, and preserve legitimate
   environment-specific differences.
8. Never duplicate an existing variable under a different name.
9. Never expose secret values in documentation, logs, reports, or example
   files.
10. If an existing variable must change for a genuine architectural or
    functional reason, explain the reason and obtain developer approval
    before changing it.

Populating previously empty variables is a one-time activity, not a standing
license: once populated (see `prompts/_037`), values fall under the stability
rules above.

#### Comments and Documentation

Every environment variable must have a meaningful comment explaining its purpose.

Comments should clarify, where applicable:

- What the variable controls.
- Whether it is required or optional.
- Its expected format or accepted values.
- Any relevant defaults or environment-specific considerations.

Avoid vague comments that merely repeat the variable name.

#### Security and Environment-Specific Values

- Never copy actual credentials, tokens, passwords, API keys, or production secrets into `.env.example`.
- Never overwrite valid environment-specific credentials just to make environment files identical.
- Preserve existing environment-specific values.
- Use safe placeholders or appropriate defaults when adding new variables.
- Do not expose secret values in logs, documentation, or Agent reports.
- Before deleting an existing environment variable, check its usage in the codebase and configuration.

**Important distinction:** Keep environment variable definitions and documentation synchronized, but preserve legitimate differences in environment-specific values.

After every environment-related change, verify the consistency of all relevant files.

## General Rules

- Inspect existing code, configuration, Git status, and relevant documentation before making changes.
- Follow established conventions and official documentation for installed dependency versions.
- Prefer simple, maintainable solutions over unnecessary abstractions or dependencies.
- Avoid `any`, unsafe type assertions, and unrelated refactoring.
- Preserve existing functionality and user changes.
- Never claim a check passed unless it actually succeeded.
- Do not suppress errors or weaken validation to make checks pass.
- Never read `process.env` or use `console.log` in application source code.
- The only permitted `process.env` access is the single environment validation call in the environment validation layer (`apps/api/src/shared/config/env/env.config.ts`).
- Read validated configuration through configuration factories and `ConfigService`, and use the Pino-backed NestJS `Logger` (provided by `nestjs-pino`, see `apps/api/src/shared/logging/`) for runtime logging; never use `console.log`.

### Engineering Principles: YAGNI, DRY, KISS

The following principles are permanent engineering rules that must guide all future implementation work, refactoring, and code review.

#### YAGNI — You Aren't Gonna Need It

- Implement only functionality that is currently required.
- Do not introduce speculative features, unnecessary extension points, or future-proof abstractions without a concrete requirement.
- Avoid adding dependencies when the existing stack can reasonably solve the problem.
- Do not build generalized solutions for hypothetical use cases.
- Prefer the smallest implementation that correctly satisfies the requirement.

#### DRY — Don't Repeat Yourself

- Avoid duplicating business logic, validation rules, configuration definitions, and reusable utilities.
- Before introducing a new implementation, check whether equivalent functionality already exists.
- Extract genuinely shared behavior into an appropriate reusable location.
- Keep a single source of truth for shared configuration and logic.
- Do not apply DRY mechanically: two similar pieces of code should not be forcibly unified when they represent different responsibilities or are likely to evolve independently.

#### KISS — Keep It Simple, Stupid

- Prefer straightforward and readable implementations.
- Avoid unnecessary indirection, abstraction, inheritance, and design patterns.
- Use the simplest solution that satisfies functional, security, and maintainability requirements.
- Keep functions and modules focused on their actual responsibilities.
- Avoid overengineering and excessive defensive programming when the underlying contract already guarantees the expected behavior.

These principles must be applied together rather than independently.

For example, do not introduce an overly generic abstraction just to satisfy DRY, and do not sacrifice correctness or security in the name of KISS.

### Happy Path First

The primary objective when implementing any function or method is to reach its successful execution path as directly and clearly as possible.

Every method should make its successful execution flow easy to identify. The happy path should normally be the main, linear body of the function, rather than code buried inside multiple nested conditional blocks.

### Guard Clauses as Default Conditional Control Flow

Every conditional structure introduced inside a function or method must be evaluated with the following question:

**Does this condition protect the happy path by handling an edge case or an exceptional state?**

Prefer guard clauses that terminate the current execution path early. Appropriate guards include:

- Invalid input
- Missing or unavailable resources
- Unauthorized or forbidden operations
- Invalid application state
- Missing records
- Duplicate operations
- Resource or dependency failures
- Boundary conditions
- Unexpected values
- Invalid state transitions

The preferred structure is:

1. Validate preconditions.
2. Handle invalid or exceptional conditions immediately.
3. Exit early using an appropriate return or throw.
4. Continue with the successful execution path.
5. Keep the remaining code linear and readable.

Avoid:

- Deeply nested `if` statements.
- Wrapping the happy path inside `else` blocks.
- Unnecessary `else` and `else if` branches after a guard has already terminated execution.
- Large conditional blocks that mix validation, error handling, and successful execution.
- Multiple levels of nesting that make the successful execution path difficult to follow.

For legitimate cases such as explicit state machines, exhaustive discriminated-union handling, transaction boundaries, or genuinely distinct business flows, use the clearest appropriate control-flow structure. Do not introduce artificial guard clauses that make the code harder to understand.

When multiple successful business paths exist, prefer extracting them into focused functions or using an appropriate dispatch/strategy structure rather than building deeply nested conditionals.

**The default expectation is fail-fast validation followed by a straightforward happy path.**

### No Magic Strings

Do not introduce unexplained string literals for application states, domain values, Redis keys, error codes, script return codes, configuration identifiers, or other semantic values. Before introducing a new string value, inspect whether an appropriate definition already exists and reuse it; avoid duplicating the same semantic value across multiple locations. Use named constants, enums, or existing domain-level definitions, following the project's naming and organization conventions. Do not create unnecessary abstractions or constants for ordinary text literals (log strings, prose). The same principle applies to numeric values with domain-specific meaning: avoid unexplained magic numbers and use named constants with explicit units in the name where appropriate (for example `OTP_SEND_WINDOW_MINUTES`, not `60`).

**Single source of truth for shared definitions.** Every enum, interface, type, and named constant used in more than one place has exactly one definition and one import path. Never copy a definition into a second module — even when the copies are textually identical today, they drift independently tomorrow; extract the shared definition into the module that owns the concept and import it everywhere else (for example a feature's shared constants living beside the feature's decorator/helper modules). Do not merge definitions that merely coincide in value but carry different meanings: DRY applies to identical _knowledge_, not to identical _text_ — coincidentally equal values get distinct names and homes.

**HTTP status codes and protocol values.** HTTP status codes must use the framework's `HttpStatus` enum or a named constant derived from it — never numeric literals (`304`) or string reason phrases (`'Not Modified'`), in conditionals, responses, headers, or documentation transforms. When the installed enum lacks a conventional member (for example 300 is named `AMBIGUOUS`), reference the member that exists and document the reasoning once, where the shared constant is defined.

**No magic values in conditionals.** Conditional statements must compare against named constants, enums, or existing domain-level definitions — never raw literals that carry semantic meaning. Ordinary text literals (log strings, prose) remain exempt.

## Imports and Type Safety

- **Import aliases:** Use the Node.js native `#...` subpath aliases for cross-directory imports instead of parent-relative imports. If a required alias does not exist, define it consistently for Node.js runtime, TypeScript, and tests before using it.
- **Type-only imports:** Import a symbol that is used only as a type with a dedicated `import type ... from ...` statement. Never mix a `type` modifier into a value import list; keep the value import and the type import as separate statements.
- **Type safety from the start:** Design all new functions, methods, classes, and other code to be type-safe from the initial implementation. Do not write loosely typed code first and postpone type safety until a type-checking error appears. Use appropriate parameter, return, and data types; avoid `any`, unsafe type assertions, and suppressions of type errors. When handling untrusted or insufficiently typed values, prefer `unknown` with proper type narrowing. Follow the project's existing TypeScript conventions without introducing unnecessary annotations or abstractions.

## Import Readability and Subpath Aliases

- When a directory or module is imported repeatedly through long or deeply nested paths, evaluate whether a Node.js `#` subpath import alias would improve readability and maintainability. A signal to evaluate — not an automatic requirement — is roughly five or more imports of the same directory from outside it, the same deep path referenced across independent modules, or import paths that have become noticeably repetitive.
- Do not create aliases for every directory: an alias must represent a meaningful, reusable internal boundary. Use the actual codebase as the reference for what the threshold means in practice.
- Before introducing an alias, inspect the existing alias conventions (`package.json` `imports` with the `types`/`default` conditions, `apps/api/test/subpath-import-aliases.ts`) and ensure compatibility with Node.js ESM, TypeScript, the build, and every test tier.
- When an alias appears beneficial, present the current import patterns, the proposed alias, the affected files, and the implementation approach to the user, and obtain approval before applying it. Identify these opportunities proactively during development instead of waiting for a dedicated task.
- After approval, update all relevant configurations and imports consistently (`package.json` `imports`, the Vitest alias shim, and every importing file), keeping value and type-only imports in separate statements per the type-only-import rule above.
- Avoid duplicate aliases, overlapping mappings, unnecessary wildcard rules, and barrel files; preserve the existing project structure and module boundaries.

## Monorepo

- Use pnpm for package management and Turborepo for task orchestration.
- Respect workspace boundaries and keep dependencies in the appropriate workspace.
- Keep `.nvmrc`, `engines.node`, `packageManager`, and the lockfile consistent.
- Use root scripts for common development and validation tasks.
- Do not modify the lockfile manually or introduce unnecessary workspaces.

## External Service Integrations

- Evaluate existing project capabilities before introducing a new dependency; prefer native capabilities plus a small internal abstraction over third-party wrappers unless a wrapper provides concrete value.
- Do not add a dependency without weighing maintenance cost, lock-in, and alignment with existing conventions (configuration, logging, testing).
- An external service must not become a mandatory startup dependency unless the architecture explicitly requires it: the application must start and serve non-dependent operations when the service is unreachable. (PostgreSQL is the one explicitly architecture-required exception — see "Database Connection Resilience" below and the ADR-027 amendment.)
- Each integration module owns its connection lifecycle (initiation and shutdown through the framework's lifecycle hooks) and must not leak that responsibility to consumers.
- Integrations must use bounded connection and command timeouts, capped retries without retry storms, predictable failure behavior, no unbounded queues, and no unhandled promise rejections.
- Report dependency degradation honestly in health checks; never mask an outage as healthy, and never let an optional dependency's outage make the process look dead.

## Resource Lifecycle and Graceful Shutdown

- Every new resource that opens connections, sockets, timers, workers, or other long-lived handles must have an appropriate initialization and cleanup lifecycle.
- Whenever a feature or infrastructure module introduces a resource that requires cleanup, implement its graceful shutdown as part of the same task.
- Do not leave open connections, workers, timers, listeners, or background processes after application shutdown.
- Use NestJS lifecycle hooks (`OnApplicationBootstrap`, `OnModuleDestroy`, `BeforeApplicationShutdown`, `OnApplicationShutdown`) and existing framework integrations where appropriate.
- Enable application shutdown hooks so termination signals are handled correctly (`enableShutdownHooks()` is already in `src/main.ts` — keep it).
- Avoid duplicate cleanup logic when an integration already manages its own resource lifecycle (e.g. `@mikro-orm/nestjs` closes the ORM connection in `onApplicationShutdown`; never close it manually as well).
- Stop accepting new work and allow in-flight work to finish before closing resources that it depends on.
- Keep shutdown logic simple and consistent with the existing architecture; do not introduce a generic lifecycle management framework.

## Database Connection Resilience

- PostgreSQL connection initialization must use bounded retries for temporary connection failures (see `src/shared/database/database.connect.ts`: 5 attempts including the first, capped exponential backoff, per-attempt timeout).
- Retry attempts must have a limited count and reasonable backoff; the limits are named constants, not per-parameter environment variables.
- Permanent configuration and authentication errors (pg SQLSTATE `28P01`, `28000`, `3D000`) must not be retried; startup fails immediately with a meaningful error.
- The application must fail startup clearly if the required database connection cannot be established after the configured attempts; never serve HTTP without the required database connection; never enter an infinite retry loop.
- Never implement blanket automatic retries for database queries, writes, or transactions; never automatically replay operations that could produce duplicate side effects (an operation whose result is ambiguous is never retried).
- Use MikroORM and PostgreSQL driver capabilities wherever possible instead of introducing custom infrastructure; no circuit breakers, bulkheads, retry decorators, custom pools, or reconnection orchestrators.
- Keep database connection resilience simple; extend it only when a concrete requirement appears.

## Database Entity and Migration Governance

Permanent rules for entity organization and database migrations (ADR-033).
Applies to every agent and every future schema change.

### Strict Database Constraint Discipline

The database is the final enforcement boundary for data integrity. Every new
or modified field gets an intentional database contract; application
validation never replaces database constraints.

- For every new or modified field, evaluate: PostgreSQL data type,
  nullability, maximum length or precision, default or generated-value
  behavior, check constraints, unique constraints, required indexes,
  lifecycle-dependent validity, and referential integrity.
- An incomplete record must be able to store only what has been collected so
  far; fields belonging to later lifecycle steps stay nullable until the
  business lifecycle makes them mandatory.
- Never add speculative constraints, and never translate an assumption into
  a database constraint: when a field's meaning, uniqueness, nullability,
  allowed values, lifecycle, or relationship is unclear, stop the schema
  work, present alternatives with consequences and a recommendation, and get
  explicit developer approval first.
- Business invariants that bound row existence (for example the
  one-non-expired-Enrollment-per-phone rule in "Neo Bank Business Domain")
  are enforced by database constraints such as partial unique indexes, not
  by application-level lookups.

### Entity Organization

- Every entity lives inside an `entities/` directory belonging to its owning
  feature module (`src/modules/<feature>/entities/<name>.entity.ts`), one
  entity per file. Entities never sit in module roots, global folders, or
  unrelated shared directories.
- Each module registers only the entities it genuinely needs with
  `MikroOrmModule.forFeature([Entity])`; never register unrelated entities
  for convenience, never expose every entity to every module, and never
  introduce a global entity list (`autoLoadEntities` + the CLI globs in
  `mikro-orm.options.ts` already enforce this structure).

### BaseEntity

- `BaseEntity` (`src/shared/database/base.entity.ts`, ADR-029) is a mapped
  superclass (`@Entity({ abstract: true })`) and must never produce its own
  database table or migration.
- Its primary key is `BIGINT` (`bigserial`) at the database level and
  `string` in application code (`BigIntType` string mode) — values are never
  converted to JavaScript `number`.
- Concrete entities inherit its fields without redeclaring them; its columns
  and check constraint appear in every concrete entity's table through
  migration.

### Date/Time Persistence

- Every newly introduced or modified date/time field uses UTC semantics end
  to end (ADR-030): `timestamptz` columns, UTC-normalized values, no
  reliance on the server's local timezone, no ambiguous local-time storage.

### Migration Immutability

- Existing migrations are immutable: never edit, delete, rename, squash, or
  rewrite a previous migration, regardless of whether it has been executed.
- Every subsequent schema change — and every correction to an existing
  migration's effects — is a new forward migration with an appropriate
  `down()` operation.
- Never silently regenerate or replace an existing migration.

### Migration Naming and Inspection

- All table and column names in migrations use `snake_case`; TypeScript
  properties stay camelCase (the default `UnderscoreNamingStrategy` handles
  the mapping — still inspect the generated SQL instead of assuming it).
- Generated migrations are always inspected (`up()`, `down()`, types,
  nullability, constraints) before execution; never blindly accept CLI
  output.

### Migration Review

- Every newly created or corrective migration must pass a structured review
  by the `migration-reviewer` subagent (read-only, in `.agents/definitions/`)
  before the task is considered complete; verdicts and findings follow
  `.agents/schemas/migration-review-report.md`.
- Migration issues are resolved through new forward migrations, never by
  editing an earlier migration; corrective migrations are reviewed again.
- A migration with unresolved blocking findings is never marked complete or
  executed.

## Concurrency, TOCTOU, and Atomicity

Every operation that checks a condition before acting on state is vulnerable to
time-of-check-to-time-of-use (TOCTOU) races when another request or background
job can change that same state concurrently. In a bank, these races surface as
duplicate enrollments, overspent balances, double-booked slots, or inconsistent
state transitions — none of which are recoverable by retries.

### Identify TOCTOU Risks

Scan every `Read → Check → Act/Write` flow for this pattern. Pay particular
attention to:

- Concurrent HTTP requests targeting the same entity (same phone number, account,
  or balance row).
- Background jobs running in parallel with API requests.
- Multiple application instances handling the same logical key.
- Operations that mutate state without holding a lock stronger than the implicit
  per-request isolation.

If another actor could change the checked condition between the read and the
write, the flow has a TOCTOU gap regardless of whether any single branch looks
correct in isolation.

### Prefer Atomic Operations

Whenever possible, fold validation and mutation into a single atomic database
operation instead of issuing a check and then an independent write:

- Use **conditional updates** (`WHERE` clauses that encode the invariant, e.g.
  `WHERE phone_number = :phone AND status <> 'EXPIRED'`) and verify the affected
  row count — zero rows means the precondition was false at the point of write.
- Use **atomic Redis commands** (`SET NX`, `INCR`, `GETSET`) or **Lua scripts**
  when the state lives in Redis; never replace an atomic script with an
  application-side check-then-act sequence. (See [[Redis Conventions]])
- Use **upsert / INSERT … ON CONFLICT** for create-if-not-exists patterns so
  the database enforces uniqueness, not the application.

### Use Appropriate Concurrency Control

- **Transactions + pessimistic locks** (`SELECT … FOR UPDATE`) when two
  incompatible actions must exclude each other entirely.
- **Optimistic locking** (version column, conflict-retry) when contention is low
  and the cost of a failed write is cheaper than holding a lock.
- **Distributed locks** only when single-instance guarantees are insufficient and
  the architecture explicitly requires them; design failure modes (missed
  releases, dead owners) deliberately — they are the common path under load.
- Never rely on application-level lookups to enforce invariants that the database
  can enforce with constraints (see [[Database Entity and Migration Governance]]).

### Never Trust Previously Read State

A successful existence check or validation at time _t_ does not guarantee the
same condition holds at time _t + δ_. When the subsequent operation executes,
revalidate the critical invariant at the point of mutation — either through the
database constraint itself (preferred) or by re-reading under a transaction.

### Idempotency Is Not Atomicity

Idempotency keys prevent duplicate processing of the same submitted request;
they do not prevent two distinct concurrent requests from both passing their
individual checks and both succeeding. Do not treat idempotency as a replacement
for proper atomicity or concurrency control — use both where required.

### Test Concurrent Execution

For critical operations, write tests that exercise simultaneous requests or
parallel workers:

- Two concurrent enrollment starts for the same phone number — exactly one must
  succeed.
- Two concurrent deductions against the same balance — total must not exceed the
  available amount.
- Rapid repeated attempts against an OTP challenge — lockout and attempt gates
  must hold.
- Verify invariants under concurrency, including preventing overspending,
  duplicate records, overbooking, quota violations, and inconsistent state
  transitions.

Simulate concurrency with controlled parallelism (e.g. `Promise.all` of request
batches inside a single transactional test, or shared-test fixtures with
intentionally reduced timeouts). If the test passes serially but fails under
load, document the race and fix it with the techniques above — do not widen
assertions to hide the issue.

## Error Response Security

- Never expose unnecessary internal information through API responses, especially error responses; disclose the minimum information a client needs.
- Do not reveal internal implementation details, database or Redis errors, stack traces, sensitive values, or reasons that would help an attacker distinguish between internal states.
- When multiple failure conditions must be indistinguishable from a security perspective, respond to all of them with the same status code, error code, and generic message.
- Detailed diagnostics belong in internal logs, never in client-facing responses.
- Never log OTP values or other sensitive authentication data.

## Redis Conventions

### Key Naming

- Every Redis key MUST follow the fixed hierarchical pattern `<app>:<module>:<feature>:<resource>:<identifier>` — for example `neo-bank:enrollments:challenge:otp:<phone>`.
- Segments are separated by `:` and are lowercase, kebab-case where a segment needs multiple words.
- The application's root namespace (`neo-bank`) is fixed and centrally defined in the integration layer; features must never invent their own top-level namespace or prefix.
- The module, feature, and resource segments must reflect the actual ownership and structure of the functionality.
- Keys must never be concatenated from scattered hardcoded strings: build them with the shared key builder (`buildRedisKey`) from a single co-located keys file per feature module that defines that feature's keys.

### Atomicity and Lua Scripting

- Whenever a Redis workflow combines dependent operations, evaluate whether a Lua script executing them atomically is the right tool.
- Prefer one atomic Lua script over separate commands whenever the operations must execute together to preserve consistency — especially read-check-write and read-check-delete flows, where independent commands introduce race conditions.
- Avoid unnecessary round trips; never replace an atomic script with application-side check-then-act sequences.
- Always build script keys with the centralized key naming convention above; never introduce arbitrary namespaces or prefixes.

## Platform-Agnostic Architecture

Platform independence must be the default design principle when developing reusable application components.

Whenever possible, application logic and NestJS components must remain independent of the underlying HTTP platform. The API runs on the official NestJS Node HTTP platform (`@nestjs/platform-node`, `NodeAdapter` — ADR-032), but the same rule applies to every application in the monorepo. This applies to, but is not limited to: guards, interceptors, pipes, exception filters, custom decorators, providers and services, middleware, shared modules, and reusable utilities.

Mandatory guidelines:

1. Avoid direct dependencies on Fastify, Express, or other HTTP platform-specific packages inside reusable application components.
2. Avoid platform-specific request and response types such as `FastifyRequest`, `FastifyReply`, or Express-specific types unless there is a clearly justified reason.
3. Prefer NestJS abstractions such as `ExecutionContext`, `ArgumentsHost`, `Reflector`, and `HttpAdapterHost` whenever they provide the required functionality.
4. Prefer application-owned interfaces and contracts when accessing information that should not depend on a particular platform.
5. Do not couple business logic or application services to HTTP framework-specific APIs.
6. If platform-specific functionality is genuinely unavoidable, isolate it in the appropriate infrastructure or HTTP platform boundary (for the API: `apps/api/src/main.ts` and its test mirror `apps/api/test/create-test-app.ts`) and expose it through an application-owned abstraction or interface.
7. Platform-specific imports must not leak into reusable components or higher-level application layers.
8. Avoid introducing unnecessary abstractions merely to achieve theoretical platform independence. Apply the principle pragmatically and follow existing architectural conventions.
9. Every exception to this rule must have a clear technical justification.

The objective is to make changing the underlying HTTP platform possible without requiring widespread changes to application components.

## Backend — NestJS

- Follow NestJS conventions for modules, dependency injection, controllers, and providers.
- Use TypeScript and ESM where supported by the selected tooling.
- Validate external input and handle errors consistently.
- Follow secure coding practices; never expose secrets or sensitive data in logs or responses.
- Use Oxlint for linting and Oxfmt for formatting.
- Do not introduce ESLint or Prettier as duplicate tooling without a concrete compatibility requirement.

### NestJS Configuration

For any task involving NestJS configuration, environment variables, environment validation, or configuration namespaces, follow `agents/rules/nest-config.md` and read `agents/skills/nest-config/SKILL.md` before making changes.

Treat this convention as the default project architecture. Inspect existing files before creating new ones, and do not introduce a competing configuration approach.

### Application Bootstrap

- Keep all bootstrap-time application configuration — HTTP adapter options such as `trustProxy` and the body-parser limit, the global API prefix, URI versioning, and CORS — directly inside the `bootstrap` function in `apps/api/src/main.ts`.
- Do not extract bootstrap configuration into a separate file such as `app.setup.ts`.

## Internationalization and Bilingual Development

The API serves users in exactly two locales — English (`en`, default) and
Persian (`fa`) — through the official `@nestjs/i18n` module (ADR-021).
Bilingual delivery is a permanent development standard, not an i18n-task-only
concern.

### Mandatory bilingual development

Every new user-facing feature must be developed with both supported locales
from the start. A feature is not complete if it introduces a user-facing
message in only one language. This applies to:

- API success messages (the response envelope's `message`).
- API error messages (Problem Details `title`/`detail`).
- Validation messages (Zod schemas).
- Custom exceptions.
- User-facing notifications and any other human-readable response text.

### Automatic localization responsibility

Whenever you introduce or modify a user-facing message, you must, without
being reminded:

1. Identify or create the translation key.
2. Add or update the English message in `apps/api/src/i18n/en/`.
3. Add the equivalent Persian message in `apps/api/src/i18n/fa/` with natural,
   formal Persian (correct grammar, correct نیم‌فاصله, consistent
   terminology).
4. Ensure placeholders match exactly between the locales.
5. Add or update the relevant tests (including the catalog-consistency tests).
6. Verify the catalog-consistency test suite passes.

### Translation ambiguity

When a Persian translation is genuinely ambiguous — terminology, tone,
singular/plural, whether a technical term should stay English — ask the user
with concrete alternatives and a recommendation before choosing. Never invent
terminology or grammar silently.

### What is never translated

- JSON property names, Zod paths, and field identifiers.
- Error codes (`ErrorCode`), HTTP statuses, and Problem Types.
- Enum identifiers and internal identifiers.
- Machine-readable API data and technical protocol values.
- Logs, diagnostics, and operator-facing messages (including environment
  validation messages).
- Values that must stay in English digits (OTP values, IDs, technical codes)
  must never be converted to Persian digits.

### Existing features

When modifying existing code that produces user-facing messages, apply the
bilingual rule to what you touch. Do not use it as a mandate for an unrelated
repository-wide localization migration.

### Completion requirement

Before declaring a feature complete, verify that its user-facing messages
exist in both catalogs and that the catalog-consistency tests and relevant
locale tests have been updated and pass.

## Frontend — Next.js and Vite

- Follow the conventions of each framework and its installed version.
- Respect TypeScript types, React component boundaries, accessibility, and error states.
- Prefer Next.js Server Components when appropriate; use `"use client"` only when needed.
- Keep frontend-specific tooling and dependencies within their respective workspaces.
- Do not apply backend-specific configurations indiscriminately to frontend applications.

## Code Quality and Testing

- Follow `.editorconfig` and the formatter configured for each workspace.
- Add or update tests for meaningful behavior changes.
- Write unit tests for features following the Arrange–Act–Assert (AAA) pattern, and accompany them with integration tests where the feature warrants end-to-end verification. Testing both levels is a project requirement, not an optional extra.
- Before committing, run checks relevant to the changed feature.
- Do not run every formatting, linting, and test command after each short implementation step, and do not start run scripts (such as `pnpm dev`) just to verify that all applications are running during intermediate steps.
- When a feature is implemented or the prompt's target is reached, run the formatter, then the linter, and then the test suite to verify everything is working correctly.
- When modified files do not relate to the main source code (for example documentation or prompt records), do not run lint or test commands and do not verify that the applications still run, because no source code changed.
- Run broader monorepo checks when shared configuration or multiple applications are affected.
- Pre-commit hooks must format and lint supported staged files through lint-staged.
- Pre-push hooks must run the repository test suite.
- Fix regressions introduced by your changes and report checks that could not run.
- Review the final diff for unintended changes.

## Semantic Versioning & Release Rules

- Follow Semantic Versioning 2.0.0 (`MAJOR.MINOR.PATCH`, https://semver.org/spec/v2.0.0.html).
- **MAJOR** for backward-incompatible public API, behavior, or data contract changes; **MINOR** for backward-compatible functionality and public API deprecations; **PATCH** for backward-compatible fixes and internal corrections. When multiple changes exist, apply the highest required increment.
- Version updates happen only during explicit release tasks — never as a side effect of ordinary development.
- Version decisions are based on the actual code changes since the latest applicable release tag (API contracts, behavior, configuration, data compatibility), not on commit messages.
- The repository uses independent-package versioning: every workspace carries its own `package.json` version. Never bump unrelated workspace packages.
- Git release tags must match the corresponding `package.json` versions, point at the commit containing that version update, and be annotated. Never overwrite or force-update an existing release tag, and never tag uncommitted changes.
- Never push tags or create release commits without explicit authorization.

## Git and Commits

- Follow Conventional Commits using Commitizen, `cz-conventional-changelog`, and Commitlint.
- When the user asks to submit a commit, call Commitizen (`git cz` or `pnpm cm`) and answer its prompts to build the commit message; do not hand-write it with `git commit -m`.
- Do not run Commitlint manually to check the commit message format; the Husky `commit-msg` hook validates it automatically. If the hook rejects the message, adjust it and retry.
- Respect Husky hooks and lint-staged configuration.
- Never bypass Git hooks unless explicitly authorized by the user.
- Never create a commit until the user explicitly approves it.
- Create no more than one commit per feature.
- Include the feature's prompt record in its commit.
- Do not amend, reset, or rewrite existing commits unless explicitly authorized.

## Multi-Agent Development Workflow

This repository ships a project-level multi-agent system (ADR-023) that works
with ZCode and Claude Code. The canonical subagent definitions live in
`.agents/definitions/` and are the single source of truth; platform files are
generated from them by `node scripts/agents/sync.mjs` (`--check` verifies
drift). Never edit generated files directly. Full workflow, setup, and
extension rules: `.agents/README.md` and
`.agents/workflows/development-workflow.md`; report templates in
`.agents/schemas/`.

Available subagents:

- `project-explorer` — read-only; establishes session context and produces a
  Project Context Report (structure in `.agents/schemas/`).
- `code-reviewer` — read-only independent judge for implementation quality;
  statuses `APPROVED` / `APPROVED_WITH_SUGGESTIONS` / `CHANGES_REQUIRED`.
- `code-security-analyzer` — read-only independent security judge; statuses
  `SECURITY_APPROVED` / `SECURITY_APPROVED_WITH_INFORMATIONAL_FINDINGS` /
  `SECURITY_CHANGES_REQUIRED`.
- `migration-reviewer` — read-only independent database migration judge
  (ADR-033); statuses `APPROVED` / `APPROVED_WITH_SUGGESTIONS` /
  `CHANGES_REQUIRED`.
- `documentation-writer` — documentation-only writes (enforced by hook where
  the platform supports it, otherwise returns ready-to-apply patches).

Orchestration rules for the primary agent:

- **Session initialization:** invoke `project-explorer` at the beginning of
  every new development session, before substantive task analysis or
  implementation. The SessionStart hook injects this instruction; this
  explicit rule remains as the fallback and as the binding requirement.
- **Review gates:** after implementation, run `code-reviewer`; only after it
  passes, run `code-security-analyzer`. The two must never receive each
  other's reports. The Mandatory Context-Blind AI Code Judgement section
  below remains in force; `code-reviewer` fulfills that role when the
  multi-agent workflow is used, and the findings tracker
  (`docs/judge-findings.md`) applies to its findings the same way.
- **Migration review:** every newly generated or corrective database
  migration is reviewed by `migration-reviewer` (ADR-033) before the task
  completes, independently of the code review gate; corrections go through
  new forward migrations only.
- **Parallel phase:** invoke `documentation-writer` in parallel with the
  testing stage; only the primary agent runs tests and only the primary
  agent supplies verified test results to it.
- **Context delivery:** never paste whole files or the whole repository into
  a subagent dispatch. Provide task summary, implementation summary, changed
  file paths (including untracked files), the relevant git diff, review
  scope, and — for re-reviews — that same reviewer's own previous findings
  with their status and a fix summary. Subagents have read access to inspect
  surrounding code themselves. Redact secrets from all shared context.
- **Iteration control:** maximum 3 fix/re-review iterations per review
  phase; preserve finding IDs; track `OPEN`/`FIXED`/`DISPUTED`; never
  downgrade a finding to obtain approval; escalate unresolved disagreements
  to the developer.
- **Platform setup:** Claude Code works from a fresh clone (project-level
  agents and hooks). ZCode requires a one-time manual plugin install from
  the local marketplace `.agents/plugins/` — see `.agents/README.md`. If
  neither platform's delegation is available, perform the roles yourself in
  sequence and say so explicitly in the final report.

## Agent Workflow

### Feature Records

1. Treat each user prompt as one feature unless the user explicitly splits it into multiple features.
2. Create one Markdown record in `prompts/` for each feature.
3. Use sequential, zero-padded filenames in lowercase kebab-case, such as `_01-monorepo-foundation.md`.
4. Include the original user request and a concise record of the implementation, relevant decisions, and validation results.
5. Write prompt records in English.
6. Preserve existing records and determine the next available number before creating a new file.
7. Include the feature record in its commit when the user approves committing.
8. Never overwrite existing records without authorization.

### Decision Records

- Whenever an addition or change is significant enough to be worth an architecture decision record, propose one proactively instead of waiting to be asked.
- Before adding the record to `DECISIONS.md`, present the proposal to the user and ask whether it should be added; only write it after explicit approval.
- Create approved decision records with **Accepted** status (the proposal remains outside the repository until explicitly approved).
- Do not create a `Pending` ADR file as a substitute for approval.
- The accepted ADR must be the first repository write associated with that feature.

### AI Decision Log

- After completing an implementation task, review the decisions made during that task and record the relevant independent decisions in `docs/ai-decisions.md`.
- An independent decision is a choice the agent made without explicit developer direction that is not already established by project documentation, conventions, or an accepted ADR. Do not record trivial implementation details (such as variable names or following an existing convention); do record meaningful choices (testing strategies, dependency introductions, boundary or behavior changes, interpretation of underspecified requirements).
- Every entry must contain: Context, Decision, Reasoning, Alternatives, Trade-offs, Impact, Reversibility, and an ADR Recommendation (whether the decision deserves a formal ADR, and why).
- Reference existing documentation (`DECISIONS.md`, `docs/judge-findings.md`, `DEFERRED.md`, the task's prompt record) instead of duplicating it.
- Recording a decision in the log does not authorize anything beyond what was already approved: a decision with architectural significance is an ADR candidate and requires developer approval before any ADR is created.
- The agent must not silently introduce significant architectural decisions. When a discovered problem seems to require one, stop and present it instead of deciding independently.

### ADR-First Development Workflow

The ADR must be proposed, reviewed, and accepted before implementation begins. This applies to new features, architectural changes, significant technical decisions, infrastructure changes, data-model decisions, and changes that materially affect system behavior.

A narrowly scoped bug fix or a trivial maintenance change that does not introduce a new technical decision does not automatically require an ADR.

#### Phase One: Investigate and Propose

Before writing implementation code:

1. Understand the requested capability.
2. Read the relevant project documentation and agent instructions.
3. Inspect the existing architecture and related implementation.
4. Review existing accepted ADRs and decisions.
5. Identify technical constraints and dependencies.
6. Identify possible edge cases and architectural consequences.
7. Evaluate reasonable alternatives.
8. Prepare a complete ADR proposal.

The proposal must follow the repository's established ADR format (see `DECISIONS.md`). At a minimum, cover:

- Title
- Context and problem statement
- Proposed decision
- Decision drivers
- Alternatives considered
- Reasons for selecting the proposed approach
- Trade-offs
- Positive consequences
- Negative consequences
- Security implications
- Performance implications
- Operational implications
- Testing and migration implications, when applicable

Do not invent project requirements or technical constraints.

#### Phase Two: ADR Proposal Must Be Presented to the User First

Present the complete ADR proposal for user review.

At this stage:

- Do not create the ADR file inside the repository.
- Do not create a `Pending` ADR file as a substitute for approval.
- Do not implement the feature.
- Do not modify the implementation to match the proposed decision.
- Do not treat your own recommendation as user approval.

The proposal must remain outside the repository until explicitly approved.

If the user requests modifications, revise the proposal and present it again.

If the user rejects it, do not proceed with implementation.

**No implicit approval is allowed.**

#### Phase Three: Accepted ADR Must Be the First Project Change

Only after explicit approval:

1. Take the approved ADR content.
2. Set its status to `Accepted`, following the repository's exact status conventions.
3. Create the ADR file in the correct location (`DECISIONS.md`).
4. Preserve the approved decision and rationale.
5. Verify that the file accurately reflects what was approved.

**The accepted ADR must be the first repository write associated with that feature.**

Do not create implementation files, change application logic, introduce dependencies, or make other feature-related modifications before the accepted ADR exists in the repository.

Do not start implementing while the ADR is still proposed, pending, or waiting for approval.

#### Phase Four: Implementation

After the accepted ADR has been written:

- Implement the capability according to the approved ADR.
- Follow the repository's engineering harness.
- Apply all happy-path and guard-clause rules.
- Use the atomic implementation workflow.
- Invoke the independent context-blind judge after each atomic unit.
- Apply valid review findings.
- Run the relevant tests and quality checks.
- Update documentation when implementation changes documented behavior.

If implementation reveals that the accepted ADR is incomplete, incorrect, or no longer appropriate:

1. Stop work on the affected implementation.
2. Explain the newly discovered issue.
3. Propose an ADR amendment or a new ADR.
4. Obtain explicit approval.
5. Record the newly accepted decision before continuing with the affected implementation.

Never silently implement a materially different decision from the accepted ADR.

### Atomic Implementation Units

Implement the smallest practical, independently reviewable unit of code. The atomic unit may be:

- A function
- A method
- A class
- A module
- Another small, independently reviewable implementation unit

Choose the smallest meaningful unit that can be reviewed independently. For example, if a feature consists of several independent functions, do not wait until the entire feature is complete before reviewing them.

The expected cycle is:

1. Implement one atomic unit.
2. Perform the minimum local checks necessary to ensure the code is reviewable.
3. Send that unit to the independent AI judge.
4. Receive the judge's report.
5. Analyze the findings.
6. Improve the implementation.
7. Re-run the judgement when changes affect the reviewed code.
8. Continue with the next atomic unit.

Keep this feedback loop throughout implementation.

### Mandatory Context-Blind AI Code Judgement

After implementing each atomic unit, you MUST invoke a separate AI reviewer acting as a strict, context-blind code judge.

Do not postpone this review until the entire feature, module, or application has been implemented.

#### Judge Isolation Requirements

The reviewer must operate independently and without the implementation context.

**Do not give the judge the feature description, task prompt, ADR, business requirements, architectural rationale, previous discussion, or your implementation decisions.**

The purpose is to prevent the reviewer from becoming biased by your intentions or from defending your implementation simply because it knows why you wrote it that way.

The judge must inspect the code as an independent critic.

Provide only:

- The exact code being reviewed.
- The minimum directly referenced declarations, types, interfaces, or contracts required to understand and inspect that code.
- The minimum technical information required to interpret its imports and dependencies.

Do not provide broader repository documentation or the reason the code was written.

Do not allow the judge to browse the full repository or retrieve the original feature context.

If the judge requires additional information, provide only the smallest technical dependency necessary. Never disclose the feature requirements to resolve its uncertainty.

The judge must not implement changes itself. Its responsibility is to inspect, criticize, and report.

**Important:** A code judge that receives the complete task description, ADR, business requirements, or implementation discussion is not a context-blind judge. Do not claim that an isolated review happened if the reviewer actually had access to that information.

Use a genuinely separate agent, sub-agent, model session, or equivalent isolated execution context. Do not simulate an independent judge by simply reviewing your own implementation and calling it an AI judgement.

If the available tooling cannot provide an independent context-isolated reviewer, report this limitation clearly. Never fabricate a judge report.

#### Judge Review Scope

The judge must be particularly strict about the following areas.

**A. Correctness and Bugs**

- Incorrect assumptions
- Incorrect control flow
- Unreachable code
- Incorrect return values
- Missing return paths
- Incorrect state transitions
- Incorrect error handling
- Inconsistent behavior
- Hidden logical bugs
- Incorrect use of asynchronous operations
- Promise handling and unhandled rejections
- Race conditions
- Concurrency-related bugs

**B. Edge Cases**

Look for realistic cases that can break the implementation, including:

- `null` and `undefined`
- Empty strings, arrays, objects, and collections
- Missing properties
- Invalid input types
- Boundary values
- Zero, negative, and unusually large values
- Unexpected state
- Duplicate operations
- Repeated requests
- Concurrent requests
- Stale or inconsistent data
- Partial failures
- Timeouts
- Resource exhaustion
- Serialization and deserialization problems
- Unexpected dependency responses

Do not limit edge-case analysis to these examples. Find additional cases based on the actual code.

**C. Security Vulnerabilities**

Inspect for relevant security weaknesses, including:

- Input validation failures
- Injection vulnerabilities
- Authorization and access-control issues
- Information leakage
- Sensitive-data exposure
- Insecure error handling
- Insecure cryptographic usage
- Timing-related weaknesses
- Race-condition vulnerabilities
- Denial-of-service opportunities
- Resource exhaustion
- Unsafe deserialization
- Incorrect trust boundaries
- Misuse of third-party APIs

**D. Performance and Resource Efficiency**

Inspect for:

- Unnecessary database or network operations
- Unnecessary Redis operations
- Repeated computation
- Inefficient algorithms
- Unnecessary memory allocations
- Memory leaks
- Blocking operations
- Unbounded loops or collections
- Excessive object copying
- Unnecessary asynchronous operations
- N+1 query patterns
- Inefficient data structures
- Unnecessary serialization or parsing
- Avoidable I/O overhead

Evaluate performance in the context of realistic execution patterns. Do not recommend meaningless micro-optimizations.

**E. Syntax and Language-Level Quality**

Inspect for:

- Unnecessarily complicated syntax
- Non-idiomatic language usage
- Redundant operations
- Unnecessary type assertions
- Unsafe type conversions
- Incorrect type narrowing
- Unnecessary optional chaining or fallback expressions
- Poor use of available language features
- Unnecessary code duplication
- Unclear abstractions
- Avoidable complexity

Prefer the simplest correct and maintainable implementation.

#### Required Judge Report Format

The judge must return a structured report.

Each finding must include:

- **Severity:** Critical, High, Medium, or Low
- **Category:** Correctness, Edge Case, Security, Performance, or Syntax/Code Quality
- **Location:** Exact file and relevant line, function, or code section
- **Problem:** What is wrong or potentially wrong?
- **Failure Scenario:** A concrete explanation of how the implementation could fail or become problematic
- **Recommendation:** A specific and technically justified improvement

The judge must distinguish actual defects from subjective preferences.

It must not produce generic comments such as "improve error handling" without identifying a concrete failure scenario.

If the implementation has no meaningful findings, explicitly report that no actionable issues were identified.

#### Mandatory Improvement Loop

The implementation agent must process every finding.

- Fix all valid Critical and High findings.
- Fix valid Medium findings.
- Evaluate Low findings and fix them when they provide a meaningful improvement.
- Reject incorrect or inapplicable findings only with a technically justified explanation.
- Do not silently ignore findings.
- Do not blindly apply a recommendation if it introduces another defect.

After making changes, run the judge again against the revised code.

Continue until there are no unresolved actionable findings, or until a remaining finding has a documented technical justification for not being applied.

The implementation agent remains responsible for validating the feature against its actual requirements. A context-blind code judge cannot replace requirement-based testing because it deliberately does not know the feature requirements.

**The purpose of this process is to make independent criticism a mandatory part of implementation, not an optional final review.**

#### Judge Findings Tracking

Every Judge AI report containing findings must be processed through the findings tracker (`docs/judge-findings.md`) before any remediation work starts:

1. Read the entire report and identify every finding, regardless of category or severity.
2. Document every finding in the tracker with: title, severity, category, affected files and locations, technical explanation, failure scenario or reproduction conditions, the Judge AI recommendation, investigation results, agreed resolution, and current status.
3. Never silently discard, omit, or downgrade a finding. A finding judged invalid or not applicable stays in the tracker with its technical justification and the status `Won't Fix`.
4. Keep findings traceable across subsequent reviews. Update the tracker as each finding progresses through the statuses: `Reported`, `Investigating`, `Awaiting Approval`, `Approved`, `In Progress`, `Resolved`, `Won't Fix (with technical justification)`.

The tracker is documentation: when the feature is committed, its findings section is part of the deliverable. Do not create duplicate tracking documents.

#### Approval Before Remediation

Judge AI recommendations are findings to investigate, not implementation requirements. For every finding:

1. Investigate the actual implementation and surrounding architecture; establish the real contract before judging the finding.
2. Identify all technically viable remediation strategies and evaluate their security, correctness, complexity, maintainability, and compatibility with existing conventions.
3. Present the viable options with advantages, disadvantages, and possible regressions, together with a recommendation, to the user.
4. Wait for explicit user approval before implementing a change that requires an architectural or behavioral decision. Minor implementation details that do not change the agreed design may be handled independently.

Judge AI findings are not exempt from the ADR-first workflow: any remediation involving an architectural decision, a meaningful behavioral change, or long-term technical consequences requires an ADR. A small bug fix does not — but never skip an ADR merely because the change originated from a Judge finding.

### Subagent Findings: Persistence, Derived Rules, and Test Integrity

The following are permanent, user-mandated rules governing every subagent report (code-reviewer, code-security-analyzer, project-explorer, documentation-writer, migration-reviewer, and any ad-hoc reviewer):

1. **Persist unimplemented recommendations.** Every recommendation from a subagent report that is not implemented must still be recorded in a durable file — the findings tracker (`docs/judge-findings.md`) with an explicit status and justification, or `DEFERRED.md` for follow-up work. A recommendation is never silently dropped, and a task is not complete while a recommendation belonging to its scope is unrecorded.
2. **Learn from every report.** After each subagent report, extract anything that generalizes — library pitfalls, concurrency patterns, convention traps, tooling gotchas — and persist it where future work will encounter it: a workspace `AGENTS.md` convention when it binds future agents, `docs/ai-decisions.md` for task-level decisions, or the task's prompt record. The same mistake must never be made twice.
3. **Tests are never sacrificed.** Under no circumstances may a test be skipped, deleted, or weakened (loosened assertions, removed cases, skip/todo markers, narrowed coverage) to make an implementation pass. If an implementation conflicts with a test, fix the implementation. A test may change only when it encodes a genuinely outdated contract, only with explicit user approval, and only into a stronger form, with the reason documented.
4. **Out-of-scope warnings become tracked follow-ups.** When a subagent flags anything as potentially out of scope, record it in `docs/judge-findings.md` and `DEFERRED.md` as a follow-up to implement or fix later — with enough context (location, failure scenario, recommendation) that a future task can act on it without re-deriving the analysis.

### Technical Tips Notes (~/Downloads/tips)

Permanent, user-mandated rule: whenever work produces an experience that cannot be found where a future reader would look — a framework or tool behavior that contradicts intuition or the docs, a non-obvious failure and its root cause, a testing or debugging technique that took a real debug cycle, a little security observation, a coding or review practice that proved itself — the agent must capture it as a tip document instead of letting it die with the session. This applies to lessons from the agent's own implementation and debugging work and to anything surfaced by subagent findings (code review, security review, migration review, documentation review).

- **Location:** `/home/ali/Downloads/tips/` (the user's system Downloads, outside every repository; the directory already exists).
- **Triggers:** processing subagent findings that reveal library/tool pitfalls; a blocked or failed operation whose root cause was non-obvious; empirical verification that overturns an architecture intuition (ordering, lifecycle, timing); remediation of a security finding worth generalizing; a convention or practice decision whose reasoning would otherwise live only in the session.
- **Format:** one topic per file, lowercase kebab-case (`topic-name.md`), English. Lead with the context, then the gotcha or lesson, then the concrete fix or pattern (code-backed where possible), then prevention. Mark clearly what was verified against installed sources or live behavior versus general knowledge. Security observations get a dedicated note with the CWE, the attack scenario, the fix, and prevention.
- **Bar for inclusion:** the "cannot be found where you'd look" test. If this repository's AGENTS.md files, ADRs, `docs/ai-decisions.md`, or `docs/judge-findings.md` already record the fact, the tip must add something they do not — the concrete mechanism, the exact command, the failure story — otherwise skip it.
- **Relationship to repository records:** these files live outside the repository. They are never committed, never referenced as project documentation, and never replace the in-repo records above; they complement them for lessons that transcend this repository.

### Delegated Validation

- Delegate validation work such as formatting, linting, running tests, and type checking to a subagent instead of executing those commands yourself.
- Read the subagent's report and base your conclusions on its results; never claim a check passed without its report confirming it.

### Retry-Loop Prevention

The agent must never get stuck in an endless retry-and-failure loop. Apply
these rules to all future tasks:

1. Never repeatedly execute the same failed command or operation without identifying a concrete reason why another attempt is likely to succeed.
2. For an ordinary failure, allow at most two attempts in total. A retry must be justified by a meaningful change or new evidence.
3. For external dependency failures, network problems, authentication failures, Docker image pull failures, and similar issues outside the agent's direct control, stop after the first unsuccessful attempt.
4. Never repeatedly retry Docker image pulls, dependency downloads, or other network-dependent operations.
5. Never silently switch to a different image, version, registry, tool, or implementation as a workaround for a failed external operation.
6. Once the retry threshold is reached, immediately stop and report:
   - What failed.
   - The exact error message.
   - What was attempted.
   - Why continuing automatically is not appropriate.
   - The exact action or command that the user needs to execute.
7. Wait for the user's intervention before continuing the blocked operation.

Prioritize identifying the cause of failure and communicating it clearly over
repeatedly attempting the same operation. This is a permanent project-wide
rule, not a task-specific instruction.

### Execution Process

1. Inspect the relevant code, configuration, Git status, and existing changes.
2. Identify the simplest maintainable solution.
3. Implement the requested changes and update relevant tests.
4. Run applicable validation commands and review their actual results.
5. Update the feature record and documentation, checking the Documentation Update Triggers table and applying every trigger the change matches.
6. Review the final diff and summarize the changes, checks, and remaining limitations.
7. Wait for explicit user approval before committing.

### Process Cleanup

- Stop every development server, preview server, test watcher, and child process started for the task before reporting completion.
- Terminate active command sessions after collecting the required results.
- Ensure processes started by the task are not left listening on application ports.
- Do not terminate processes that were already running before the task began.
- The execution platform owns the sandbox lifecycle. Clean up processes started inside it, but never attempt to terminate the host sandbox.

**Zero-orphan rule — everything the task starts must be torn down before the task reports completion:**

- This covers every long-lived thing the task spawns: host processes and background commands, Docker Compose projects and one-off containers, networks, and any other handle the task created. An agent-run that ends (or a session that gets interrupted) is not an excuse for leftovers.
- One-off Docker Compose runs (for example `docker compose -f compose.app.dev.yml up -d <service>` for a verification step) must be torn down with `docker compose ... down` on the same file and project, or explicitly handed to the developer as still-running — never abandoned silently. Standalone compose files with their own `name:` create a _parallel project_ next to the orchestrator stack; a duplicate project holding application ports blocks the real stack (`port is already allocated`).
- Verify before reporting completion: no task-started process is still listening (`ss -ltnp` on the ports involved), and `docker ps` shows no task-started containers unless they are the explicit, agreed deliverable (for example "bring up the dev stack" tasks).
- Data volumes follow this rule only when the task created them as scratch (delete then); persistent data volumes that predate the task or that the developer relies on are never deleted.
- When cleanup is impossible or would destroy state the developer needs, say so explicitly in the final report instead of leaving the orphan silently.

## Definition of Done

A feature is complete when its implementation and prompt record are updated, every matched entry from the Documentation Update Triggers table has been applied, relevant checks have been executed, unintended changes have been ruled out, task-created processes have been cleaned up, and remaining limitations are reported.

Do not report successful validation for checks that were skipped or failed.

## Dependency and Utility Evaluation

Before introducing any new dependency, package, helper, utility, or external tool, you MUST follow the [Dependency Evaluation Skill](.agents/skills/dependency-evaluation/SKILL.md).

- Evaluate whether the requirement can be implemented reliably with no more than 200 lines of production code, excluding tests.
- Identify relevant edge cases and write tests before integrating a new internal implementation.
- Prefer existing project capabilities or a small internal implementation over unnecessary dependencies.
- Evaluate security, maintenance status, compatibility, licensing, and supply-chain risks before installing any external package.
- Verify and select the latest stable release compatible with the project.
- Document every newly introduced external dependency or tool in `DECISIONS.md` using the established Architecture Decision Record (ADR) format.
- If no suitable and sufficiently safe solution can be identified, stop and ask the user before proceeding.

Do not skip this process for convenience. Follow the full procedure defined in the linked skill.

Ponytail's simplicity principles MUST NOT override the skill's requirements for security, compatibility, testing, documentation, or explicit user approval.

## Semantic Versioning

Follow Semantic Versioning 2.0.0 (`MAJOR.MINOR.PATCH`) for all versioned workspaces. The [`semantic-versioning` skill](.claude/skills/semantic-versioning/SKILL.md) provides actionable instructions for classifying changes, updating versions, creating Git tags, and reporting version decisions. Apply it whenever a bug fix or feature implementation is complete.

<!-- gitnexus:start -->

# GitNexus — Code Intelligence

This project is indexed by GitNexus as **neo-bank** (2459 symbols, 4493 relationships, 41 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact before editing.** Use `impact({target: "symbolName", direction: "upstream"})` or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .`; report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- MUST warn on HIGH/CRITICAL `risk` pre-edit; never use `riskSharedAxes` to waive a HIGH/CRITICAL `risk` warning. Compare File/symbol: MCP File omits axes; Graph-RAG expands File.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- **MUST use `query({search_query: "concept"})` for concepts/flows, `context({name: "symbolName"})` for a named symbol, or `impact` for blast radius, on read-only callers, dependencies, imports, or execution flow.** Graph first; text search only for empty/`UNKNOWN`/literals.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource                                  | Use for                                  |
| ----------------------------------------- | ---------------------------------------- |
| `gitnexus://repo/neo-bank/context`        | Codebase overview, check index freshness |
| `gitnexus://repo/neo-bank/clusters`       | All functional areas                     |
| `gitnexus://repo/neo-bank/processes`      | All execution flows                      |
| `gitnexus://repo/neo-bank/process/{name}` | Step-by-step execution trace             |

## CLI

| Task                                         | Read this skill file                               |
| -------------------------------------------- | -------------------------------------------------- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md`       |
| Blast radius / "What breaks if I change X?"  | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?"             | `.claude/skills/gitnexus-debugging/SKILL.md`       |
| Rename / extract / split / refactor          | `.claude/skills/gitnexus-refactoring/SKILL.md`     |
| Tools, resources, schema reference           | `.claude/skills/gitnexus-guide/SKILL.md`           |
| Index, status, clean, wiki CLI commands      | `.claude/skills/gitnexus-cli/SKILL.md`             |

<!-- gitnexus:end -->
