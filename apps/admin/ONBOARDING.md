# ONBOARDING.md — apps/admin

Developer onboarding guide for the Neo Bank admin dashboard. Written for
someone who has never seen this repository.

## 1. Introduction

This is the internal admin dashboard of Neo Bank. It is a Vite + React 19
single-page application. **It is currently a bare scaffold**: one `App`
component that renders "Neo Bank Admin". No routing, API integration, auth,
or styling exists yet.

Within the monorepo it is the `apps/admin` workspace. The backend it will
eventually talk to lives in `apps/api` (NestJS, port 3001) but is not
connected yet. Monorepo context:
[../../docs/architecture.md](../../docs/architecture.md).

## 2. Technology Stack

| Technology                              | Purpose                                                   |
| --------------------------------------- | --------------------------------------------------------- |
| Vite 8                                  | Dev server and build tooling                              |
| React 19                                | UI library                                                |
| TypeScript (strict, project references) | Type safety; `tsc -b` type-checks and gates builds        |
| @vitejs/plugin-react                    | React fast-refresh integration                            |
| Oxlint / Oxfmt                          | Linting and formatting (with `react`, `jsx-a11y` plugins) |

That is the complete dependency list — no router, state management, styling,
or UI library is installed yet.

## 3. Prerequisites

- Node.js **24.20.0** (range `>=24.15 <25`, see `/.nvmrc`).
- pnpm **12.10.1** (`corepack enable` if missing).
- No environment variables are required — the app has none defined yet.

## 4. Getting Started

From the repository root:

```sh
pnpm install --frozen-lockfile
```

Then, from `apps/admin`:

```sh
pnpm dev          # dev server on http://localhost:5173
```

Other commands:

```sh
pnpm build        # tsc -b && vite build → dist/
pnpm preview      # serve dist/ locally
pnpm lint         # Oxlint
pnpm format       # Oxfmt (write)
pnpm typecheck    # tsc -b --pretty false
pnpm clean        # remove dist/
```

There is no test command — no test setup exists in this app yet.

## 5. Project Structure

```
index.html            # Vite entry point
src/
  main.tsx            # React root
  App.tsx             # the (only) component
tsconfig.json         # solution file referencing the two configs below
tsconfig.app.json     # browser source code
tsconfig.node.json    # vite.config.ts
vite.config.ts        # React plugin only
```

**Where new features go:** components under `src/`. Structure beyond that
(routing, state, styling) should be proposed and agreed on before being
introduced — nothing is decided yet.

## 6. Development Workflow

- **Adding UI:** build React components in `src/`; `pnpm dev` hot-reloads.
- **Routing / state / styling:** nothing is chosen yet; propose first.
- **Talking to the API:** not implemented. When it becomes relevant, define
  the approach (client, base URL, auth handling, shared types with the
  backend) as a deliberate decision.
- **Type safety:** `build` runs `tsc -b` before `vite build`, so type errors
  fail the build; `pnpm typecheck` is the standalone check.
- **Lint/format:** enforced automatically on commit via Husky + lint-staged
  at the repo root.
- **Commit workflow:** Conventional Commits via `pnpm cm` at the repo root;
  see [../../AGENTS.md](../../AGENTS.md).

## 7. Important Notes

- The app is a scaffold — do not assume hidden conventions; there are none
  beyond what this file and the root rules state.
- The tsconfig setup uses **project references**: `tsconfig.app.json` covers
  browser code, `tsconfig.node.json` covers `vite.config.ts`. Keep new files
  under `src/` to stay in the app project.
- Root-level rules in [../../AGENTS.md](../../AGENTS.md) (import hygiene,
  no unrelated refactoring, feature records in `prompts/`, approval before
  commits) apply fully.
- Architectural decisions are recorded in
  [../../DECISIONS.md](../../DECISIONS.md); none currently concern the admin
  app specifically.

## 8. Useful Commands

| Command          | Effect                                   |
| ---------------- | ---------------------------------------- |
| `pnpm dev`       | Vite dev server at http://localhost:5173 |
| `pnpm build`     | Type-check + production build            |
| `pnpm preview`   | Serve the production build               |
| `pnpm lint`      | Oxlint                                   |
| `pnpm format`    | Oxfmt write                              |
| `pnpm typecheck` | TypeScript project check                 |
| `pnpm clean`     | Remove `dist/`                           |

All from `apps/admin`; workspace-wide variants exist at the repo root via
Turborepo.
