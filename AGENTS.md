# AGENTS.md

## Project Overview

This is a TypeScript monorepo managed with pnpm and Turborepo.

- `apps/api`: NestJS backend.
- `apps/web`: Next.js web application.
- `apps/admin`: React + Vite admin dashboard.
- `prompts/`: Feature records and implementation prompts.
- `docs/`: Repository-level architecture documentation.

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
  `docs/observability/`, `docs/security-otp-enrollment.md`, ADRs) are read
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

## Imports and Type Safety

- **Import aliases:** Use the Node.js native `#...` subpath aliases for cross-directory imports instead of parent-relative imports. If a required alias does not exist, define it consistently for Node.js runtime, TypeScript, and tests before using it.
- **Type safety from the start:** Design all new functions, methods, classes, and other code to be type-safe from the initial implementation. Do not write loosely typed code first and postpone type safety until a type-checking error appears. Use appropriate parameter, return, and data types; avoid `any`, unsafe type assertions, and suppressions of type errors. When handling untrusted or insufficiently typed values, prefer `unknown` with proper type narrowing. Follow the project's existing TypeScript conventions without introducing unnecessary annotations or abstractions.

## Monorepo

- Use pnpm for package management and Turborepo for task orchestration.
- Respect workspace boundaries and keep dependencies in the appropriate workspace.
- Keep `.nvmrc`, `engines.node`, `packageManager`, and the lockfile consistent.
- Use root scripts for common development and validation tasks.
- Do not modify the lockfile manually or introduce unnecessary workspaces.

## External Service Integrations

- Evaluate existing project capabilities before introducing a new dependency; prefer native capabilities plus a small internal abstraction over third-party wrappers unless a wrapper provides concrete value.
- Do not add a dependency without weighing maintenance cost, lock-in, and alignment with existing conventions (configuration, logging, testing).
- An external service must not become a mandatory startup dependency unless the architecture explicitly requires it: the application must start and serve non-dependent operations when the service is unreachable.
- Each integration module owns its connection lifecycle (initiation and shutdown through the framework's lifecycle hooks) and must not leak that responsibility to consumers.
- Integrations must use bounded connection and command timeouts, capped retries without retry storms, predictable failure behavior, no unbounded queues, and no unhandled promise rejections.
- Report dependency degradation honestly in health checks; never mask an outage as healthy, and never let an optional dependency's outage make the process look dead.

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

- Keep all bootstrap-time application configuration — Fastify adapter options such as `trustProxy` and `bodyLimit`, the global API prefix, URI versioning, and CORS — directly inside the `bootstrap` function in `apps/api/src/main.ts`.
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
