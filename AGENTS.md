# AGENTS.md

## Project Overview

This is a TypeScript monorepo managed with pnpm and Turborepo.

- `apps/api`: NestJS backend.
- `apps/web`: Next.js web application.
- `apps/admin`: React + Vite admin dashboard.
- `prompts/`: Feature records and implementation prompts.

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
- Read validated configuration through configuration factories and `ConfigService`, and use the NestJS `Logger` for runtime logging.

## Monorepo

- Use pnpm for package management and Turborepo for task orchestration.
- Respect workspace boundaries and keep dependencies in the appropriate workspace.
- Keep `.nvmrc`, `engines.node`, `packageManager`, and the lockfile consistent.
- Use root scripts for common development and validation tasks.
- Do not modify the lockfile manually or introduce unnecessary workspaces.

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
5. Update the feature record and relevant documentation.
6. Review the final diff and summarize the changes, checks, and remaining limitations.
7. Wait for explicit user approval before committing.

### Process Cleanup

- Stop every development server, preview server, test watcher, and child process started for the task before reporting completion.
- Terminate active command sessions after collecting the required results.
- Ensure processes started by the task are not left listening on application ports.
- Do not terminate processes that were already running before the task began.
- The execution platform owns the sandbox lifecycle. Clean up processes started inside it, but never attempt to terminate the host sandbox.

## Definition of Done

A feature is complete when its implementation and prompt record are updated, relevant checks have been executed, unintended changes have been ruled out, task-created processes have been cleaned up, and remaining limitations are reported.

Do not report successful validation for checks that were skipped or failed.
