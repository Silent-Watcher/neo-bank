# Neo Bank monorepo

Minimal TypeScript monorepo managed with pnpm workspaces and Turborepo.

## Applications

| Application  | Framework          | Default port |
| ------------ | ------------------ | ------------ |
| `apps/api`   | NestJS / Fastify   | 3001         |
| `apps/web`   | Next.js App Router | 3000         |
| `apps/admin` | Vite + React       | 5173         |

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
pnpm test
pnpm test:redis   # API Redis integration tests (requires running Redis)
pnpm docker:dev   # start the full Docker dev stack in the background
pnpm docker:prod  # start the full Docker production stack in the background
pnpm docker:monitoring   # centralized log monitoring (Grafana + Loki + Alloy)
pnpm clean
pnpm cm
```

`pnpm cm` opens Commitizen. Commits follow Conventional Commits with optional `api`, `web`, `admin`, or `monorepo` scopes, for example `feat(api): add accounts endpoint`. Husky formats and lints staged files before commits, validates commit messages, and runs `pnpm test` before pushes.

## Docker

The full stack — API, web, admin, PostgreSQL, Redis — can also run in Docker, in development (hot reloading) and production configurations. See [`docs/docker.md`](./docs/docker.md).

Centralized log monitoring (Grafana, Loki, Grafana Alloy) runs as an independent Compose stack; Grafana is at `http://localhost:3002` when monitoring is up. Operations: [`docs/observability/README.md`](./docs/observability/README.md).

Nest CLI currently requires TypeScript 6 because TypeScript 7 temporarily does not expose the compiler API Nest uses. The root pins `typescript@6.0.3` until that upstream compatibility gap closes.

## Agent workflow and prompt records

[`AGENTS.md`](./AGENTS.md) defines the repository workflow: one user prompt, one feature, one prompt file, and one approved commit. Each feature has one record in [`prompts/`](./prompts) that captures the request and completed work. Agents must wait for explicit user approval before creating a commit.
