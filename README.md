# Neo Bank monorepo

Minimal TypeScript monorepo managed with pnpm workspaces and Turborepo.

## Applications

| Application  | Framework          | Default port |
| ------------ | ------------------ | ------------ |
| `apps/api`   | NestJS / Express   | 3001         |
| `apps/web`   | Next.js App Router | 3000         |
| `apps/admin` | Vite + React       | 5173         |

## Requirements

- Node `24.20.0` (allowed range: `>=24.15 <25`)
- pnpm `12.10.1`

## Setup

```sh
pnpm install --frozen-lockfile
cp apps/api/.env.example apps/api/.env
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
pnpm test
pnpm clean
pnpm commit
```

`pnpm commit` opens Commitizen. Commits follow Conventional Commits with optional `api`, `web`, `admin`, or `monorepo` scopes, for example `feat(api): add accounts endpoint`. Husky formats and lints staged files before commits, validates commit messages, and runs `pnpm test` before pushes.

Nest CLI currently requires TypeScript 6 because TypeScript 7 temporarily does not expose the compiler API Nest uses. The root pins `typescript@6.0.3` until that upstream compatibility gap closes.

## Agent workflow and prompt records

[`AGENTS.md`](./AGENTS.md) defines the repository workflow: one user prompt, one feature, one prompt file, and one approved commit. Each feature has one record in [`prompts/`](./prompts) that captures the request and completed work. Agents must wait for explicit user approval before creating a commit.
