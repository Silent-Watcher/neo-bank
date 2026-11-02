# ONBOARDING.md — apps/web

Developer onboarding guide for the Neo Bank customer web application.
Written for someone who has never seen this repository.

## 1. Introduction

This is the customer-facing web application of Neo Bank. It is a Next.js 16
App Router application on React 19. **It is currently a bare scaffold**: a
root layout and a single index page that renders "Neo Bank". No features,
routing, API integration, or styling exist yet.

Within the monorepo it is the `apps/web` workspace. The backend it will
eventually talk to lives in `apps/api` (NestJS, port 3001) but is not
connected yet. Monorepo context:
[../../docs/architecture.md](../../docs/architecture.md).

## 2. Technology Stack

| Technology                    | Purpose                                                             |
| ----------------------------- | ------------------------------------------------------------------- |
| Next.js 16                    | React framework — App Router, routing, build tooling                |
| React 19                      | UI library                                                          |
| TypeScript (strict, `noEmit`) | Type safety; Next.js does the compilation                           |
| Oxlint / Oxfmt                | Linting and formatting (with `react`, `jsx-a11y`, `nextjs` plugins) |

That is the complete dependency list — the app intentionally has no state
management, styling, data-fetching, or UI libraries yet.

## 3. Prerequisites

- Node.js **24.20.0** (range `>=24.15 <25`, see `/.nvmrc`).
- pnpm **12.10.1** (`corepack enable` if missing).
- No environment variables are required — the app has none defined yet.

## 4. Getting Started

From the repository root:

```sh
pnpm install --frozen-lockfile
```

Then, from `apps/web`:

```sh
pnpm dev          # development server on http://localhost:3000
```

Other commands:

```sh
pnpm build        # production build (.next/)
pnpm start        # serve the production build
pnpm lint         # Oxlint
pnpm format       # Oxfmt (write)
pnpm typecheck    # tsc --noEmit
pnpm clean        # remove .next
```

There is no test command — no test setup exists in this app yet.

## 5. Project Structure

```
app/
  layout.tsx    # root layout: <html>/<body> shell, metadata ("Neo Bank")
  page.tsx      # index route
next.config.ts  # currently empty NextConfig
```

**Where new features go:** new routes as `app/<route>/page.tsx` (App Router
conventions); shared UI as components colocated with their routes or in a
`components/` directory once one is warranted. Since almost nothing exists
yet, propose structural decisions (styling, state, API access) before
introducing them rather than picking silently.

## 6. Development Workflow

- **Adding a page:** create `app/<route>/page.tsx`. Prefer Server
  Components; mark a file `"use client"` only when it needs browser
  interactivity.
- **Styling / data fetching / state:** nothing is chosen yet. Any of these
  choices is a convention decision to agree on first.
- **Talking to the API:** not implemented. When it becomes relevant, define
  the approach (fetch wrapper vs. generated client, shared types with the
  backend) as a deliberate decision.
- **Lint/format:** enforced automatically on commit via Husky + lint-staged
  at the repo root.
- **Commit workflow:** Conventional Commits via `pnpm cm` at the repo root;
  see [../../AGENTS.md](../../AGENTS.md).

## 7. Important Notes

- The app is a scaffold — do not assume hidden conventions; there are none
  beyond what this file and the root rules state.
- TypeScript is strict; `pnpm typecheck` is the gate (`tsc --noEmit`).
- Root-level rules in [../../AGENTS.md](../../AGENTS.md) (import hygiene,
  no unrelated refactoring, feature records in `prompts/`, approval before
  commits) apply fully.
- Architectural decisions are recorded in
  [../../DECISIONS.md](../../DECISIONS.md); none currently concern the web
  app specifically.

## 8. Useful Commands

| Command          | Effect                              |
| ---------------- | ----------------------------------- |
| `pnpm dev`       | Dev server at http://localhost:3000 |
| `pnpm build`     | Production build                    |
| `pnpm start`     | Serve the production build          |
| `pnpm lint`      | Oxlint                              |
| `pnpm format`    | Oxfmt write                         |
| `pnpm typecheck` | TypeScript check                    |
| `pnpm clean`     | Remove `.next`                      |

All from `apps/web`; workspace-wide variants exist at the repo root via
Turborepo.
