# Neo Bank monorepo

Minimal TypeScript monorepo managed with pnpm workspaces and Turborepo.

## Applications

| Application  | Framework            | Default port |
| ------------ | -------------------- | ------------ |
| `apps/api`   | NestJS (NodeAdapter) | 3001         |
| `apps/web`   | Next.js App Router   | 3000         |
| `apps/admin` | Vite + React         | 5173         |

## Requirements

- Node `24.20.0` (allowed range: `>=24.15 <25`)
- pnpm `12.10.1`

## Setup

```sh
pnpm install --frozen-lockfile
cp apps/api/env/.env.example apps/api/env/.env.development
```

`PORT` can override the API's default port.

## Commands

```sh
pnpm dev
pnpm build
pnpm lint
pnpm format
pnpm format:check
pnpm typecheck
pnpm test         # all test suites (unit + e2e + Redis + DB) across workspaces via Turborepo — integration tiers require Docker
pnpm test:e2e     # API e2e tests only (one shared Testcontainers Redis + PostgreSQL; requires Docker)
pnpm test:redis   # API Redis integration tests only (requires Docker)
pnpm test:db      # API database integration tests only (requires Docker)
pnpm test:coverage  # API unit tests with Vitest coverage (text + HTML + LCOV under apps/api/coverage/)
pnpm docker:dev   # start the full Docker dev stack in the background
pnpm docker:prod  # start the full Docker production stack in the background
pnpm docker:monitoring   # centralized log monitoring (Grafana + Loki + Alloy)
pnpm clean
pnpm cm
```

`pnpm cm` opens Commitizen. Commits follow Conventional Commits with optional `api`, `web`, `admin`, or `monorepo` scopes, for example `feat(api): add accounts endpoint`. Husky formats and lints staged files before commits, and runs `pnpm test` before pushes — since the root `test` script covers all suites, pushes are gated on unit, e2e, Redis, and database integration tests alike (ADR-035).

Testing is Turborepo-native: each workspace owns its own test configuration, and the root commands discover workspaces that expose conventional `test` / `test:coverage` scripts — a new application joins the pipeline by adding those scripts, with no central list to maintain. Workspaces without test scripts (web, admin today) are skipped. Coverage reports land in the workspace's `coverage/` directory (currently only the API, unit tier).

Type safety is audited with `typehealth` (root devDependency): `npx typehealth scan --cwd apps/<app> --config apps/<app>/tsconfig.json --format markdown`. Every workspace tsconfig enables all supported strictness compiler options; `apps/admin` must be scanned with `tsconfig.app.json` (its root `tsconfig.json` is a solution-style reference file).

## Code Intelligence (GitNexus)

The repository is indexed by GitNexus, a code-graph tool (symbols, dependency relationships, execution flows). Use it to understand the codebase faster than broad text searching — "how does X work?", "who calls Y?", "what breaks if I change Z?".

All commands run through the local runner from the repository root:

```sh
node .gitnexus/run.cjs status --repo .                                  # index freshness
node .gitnexus/run.cjs analyze --index-only                             # re-index after large changes
node .gitnexus/run.cjs query "concept" --repo .                         # find code by concept/flow
node .gitnexus/run.cjs context "SymbolName" --repo .                    # inspect a named symbol
node .gitnexus/run.cjs impact "SymbolName" --direction upstream --repo .  # callers / blast radius
node .gitnexus/run.cjs detect-changes --scope all --repo .              # graph diff before committing
```

Notes:

- An index is registered at `.gitnexus/`; check freshness with `status`. After large refactors or many new files, re-run `analyze --index-only`.
- Treat an empty caller set or `risk: UNKNOWN` from `impact` as unresolved, not as unused — confirm with a text search before deleting or changing a symbol.
- Per-task workflows (exploring, impact analysis, debugging, refactoring) are documented in the `gitnexus-*` skills under `.agents/skills/` and `.claude/skills/`.

## Docker

The full stack — API, web, admin, PostgreSQL, Redis, plus development-only MockServer for resilience testing (ADR-024) and pgAdmin for PostgreSQL administration (ADR-028) — can also run in Docker, in development (hot reloading) and production configurations. See [`docs/docker.md`](./docs/docker.md).

Centralized log monitoring (Grafana, Loki, Grafana Alloy) runs as an independent Compose stack; Grafana is at `http://localhost:3002` when monitoring is up. Operations: [`docs/observability/README.md`](./docs/observability/README.md).

Nest CLI currently requires TypeScript 6 because TypeScript 7 temporarily does not expose the compiler API Nest uses. The root pins `typescript@6.0.3` until that upstream compatibility gap closes.

## Agent workflow and prompt records

[`AGENTS.md`](./AGENTS.md) defines the repository workflow: one user prompt, one feature, one prompt file, and one approved commit. Each feature has one record in [`prompts/`](./prompts) that captures the request and completed work. Agents must wait for explicit user approval before creating a commit.
