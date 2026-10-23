# Production TypeScript Monorepo

## User prompt

Build this empty directory as a Git repository using pnpm workspaces and Turborepo. Use Node 24.20.0 / `>=24.15 <25`, pnpm 12.10.1, and stable framework/tool releases compatible with that runtime. Create only three starter applications: a NestJS API on port 3001, a Next.js App Router web application on port 3000, and a Vite React admin application on Vite's default port.

Use root-owned Oxlint and Oxfmt, Conventional Commits with Commitizen, Commitlint, Husky, and lint-staged. Add Turbo root commands for development, build, lint, formatting, type checks, tests, cleaning, and commits. Keep the workspace minimal: no shared packages, database, authentication, UI framework, CI, Docker, or business features.

## Completed work

Created the pnpm/Turborepo workspace, the three framework starter applications, Oxlint/Oxfmt configuration, commit tooling, Husky pre-commit and commit-message hooks, documentation, and a locked dependency graph. Validated frozen installation, linting, formatting, type checking, API unit/e2e tests, and production builds.

## Known limitation

The environment supplied an unwritable invalid `.git` directory, so Git initialization and live hook installation could not be completed here. The repository hook scripts are present and ready for a writable Git checkout.
