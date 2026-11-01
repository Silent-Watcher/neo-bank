# AGENTS.md — apps/web

Application-specific instructions for AI coding agents working on the Next.js
web application. Repository-wide rules in the root
[AGENTS.md](../../AGENTS.md) apply in full; this file only adds
web-specific conventions.

## Purpose

The customer-facing web application for Neo Bank. Currently a bare Next.js
App Router scaffold (one layout, one page); feature development has not
started. Status: [../../docs/current-state.md](../../docs/current-state.md).

## Stack

- Next.js 16 (App Router), React 19, TypeScript strict mode.
- No runtime dependencies beyond `next`/`react`/`react-dom` — do not add
  dependencies without explicit justification.
- Oxlint with `typescript`, `react`, `jsx-a11y`, and `nextjs` plugins;
  Oxfmt for formatting. No ESLint/Prettier.
- **No test setup exists yet.** There is no test script; introducing one is
  a convention decision to agree on first, not a silent addition.

## Architecture and Conventions

- **App Router only:** routes and layouts live in `app/` using Next.js 16
  conventions. Prefer Server Components; add `"use client"` only when a
  component genuinely needs client interactivity (root rule).
- **No API integration exists.** The app does not call `apps/api` yet; when
  that lands, its shape (client, shared types, base URL handling) should be
  decided deliberately, not improvised per page.
- **No styling system, state library, or data-fetching library is installed.**
  Inspect what exists before introducing any of them; propose the choice
  rather than picking silently.
- TypeScript is strict with `noEmit` — Next.js handles compilation.
- Keep framework config (`next.config.ts`) minimal; it is currently empty by
  intent.

## Directory Structure

```
app/
  layout.tsx    # root layout (metadata, html/body shell)
  page.tsx      # index route
next.config.ts  # empty NextConfig
```

New routes: add directories under `app/` following Next.js App Router
conventions (`app/<route>/page.tsx`).

## Testing Expectations

None defined yet. Do not add speculative test infrastructure; wait for the
project to decide on a runner (the API uses Vitest — likely alignment, but
not yet decided).

## Commands

```sh
pnpm dev          # next dev on http://localhost:3000
pnpm build        # next build
pnpm start        # serve the production build
pnpm lint         # oxlint
pnpm format       # oxfmt --write .
pnpm typecheck    # tsc --noEmit
pnpm clean        # remove .next
```

## Constraints

- Do not duplicate root rules here; this file covers only web specifics.
- Do not document or implement hypothetical features (API clients, auth,
  state management) as if they existed.
- Architectural decisions affecting the web app belong in
  [../../DECISIONS.md](../../DECISIONS.md) via the root decision-record
  workflow.
- When a change matches a Documentation Update Triggers entry in the root
  [AGENTS.md](../../AGENTS.md), update the listed documentation in the same
  task (for the web app that is usually this file, `ONBOARDING.md`, and
  `docs/current-state.md`).
