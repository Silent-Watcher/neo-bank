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
- Identify the application or package the task concerns before exploring the
  codebase, then read that workspace's nested `AGENTS.md` (for example
  `apps/api/AGENTS.md`) before changing its code.
- Consult `docs/architecture.md` when a task involves cross-application
  architecture or workspace boundaries.
- Consult `docs/current-state.md` before implementing functionality that
  might already exist, partially exist, or depend on an unfinished feature.
- Inspect only the source files relevant to the current task; do not read the
  entire repository unnecessarily.
- Never assume documentation is more accurate than the actual implementation;
  when they conflict, trust the code and flag the discrepancy.

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

When a change matches no trigger, no documentation update is required — but
if you are unsure whether a change is "material", update rather than skip.

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
- Create approved decision records with **Pending** status.
- Present the pending decision to the user and wait for explicit acceptance before continuing development that depends on it.

### Delegated Validation

- Delegate validation work such as formatting, linting, running tests, and type checking to a subagent instead of executing those commands yourself.
- Read the subagent's report and base your conclusions on its results; never claim a check passed without its report confirming it.

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
