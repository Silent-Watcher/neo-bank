# AGENTS.md — apps/admin

Application-specific instructions for AI coding agents working on the admin
dashboard. Repository-wide rules in the root [AGENTS.md](../../AGENTS.md)
apply in full; this file only adds admin-specific conventions.

## Purpose

The internal admin dashboard for Neo Bank. Currently a bare Vite + React
scaffold (one component); feature development has not started. Status:
[../../docs/current-state.md](../../docs/current-state.md).

## Stack

- Vite 8, React 19, TypeScript strict mode with project references
  (`tsconfig.app.json` for browser code, `tsconfig.node.json` for Vite
  config; `typecheck` and `build` run `tsc -b`).
- `@vitejs/plugin-react` is the only build-related dependency; no router,
  state, styling, or UI library is installed.
- Oxlint with `typescript`, `react`, and `jsx-a11y` plugins; Oxfmt for
  formatting. No ESLint/Prettier.
- **No test setup exists yet.** There is no test script; introducing one is
  a convention decision to agree on first, not a silent addition.

## Architecture and Conventions

- Plain Vite SPA (`src/main.tsx` → `src/App.tsx`); no server-side rendering.
- **No API integration exists.** The app does not call `apps/api` yet; when
  it does, the approach (client, base URL, auth, shared types) should be
  decided deliberately, not improvised per component.
- ESM (`"type": "module"`); `verbatimModuleSyntax`-style hygiene per
  tsconfig — import types with `import type`.
- Keep `vite.config.ts` minimal (currently only the React plugin).

## Directory Structure

```
index.html            # Vite entry
src/
  main.tsx            # React root
  App.tsx             # single component
tsconfig.json         # solution file (references app + node configs)
tsconfig.app.json     # browser code
tsconfig.node.json    # vite.config.ts
vite.config.ts
```

New features: components under `src/`; introduce routing/state/styling
structure only after the choice is agreed on.

## Testing Expectations

None defined yet. Do not add speculative test infrastructure; wait for the
project to decide on a runner (the API uses Vitest — likely alignment, but
not yet decided).

## Commands

```sh
pnpm dev          # vite dev server on http://localhost:5173
pnpm build        # tsc -b && vite build → dist/
pnpm preview      # serve the production build locally
pnpm lint         # oxlint
pnpm format       # oxfmt --write .
pnpm typecheck    # tsc -b --pretty false
pnpm clean        # remove dist
```

## Constraints

- Do not duplicate root rules here; this file covers only admin specifics.
- Do not document or implement hypothetical features (API clients, auth,
  routing) as if they existed.
- Architectural decisions affecting the admin app belong in
  [../../DECISIONS.md](../../DECISIONS.md) via the root decision-record
  workflow.
- When a change matches a Documentation Update Triggers entry in the root
  [AGENTS.md](../../AGENTS.md), update the listed documentation in the same
  task (for the admin app that is usually this file, `ONBOARDING.md`, and
  `docs/current-state.md`).
