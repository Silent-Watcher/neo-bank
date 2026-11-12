# PROJECT_CONTEXT

Primary architectural and technical context for development sessions. Read
after the root `AGENTS.md`; use it to decide which further documentation or
source files a task needs. Detailed documents stay independent — see the
Documentation Index. Last verified: 2026-11-11.

## Repository Overview

Neo Bank is an early-stage banking product: a TypeScript pnpm-workspace
monorepo orchestrated by Turborepo. Node `24.20.0` (`.nvmrc`, engines
`>=24.15 <25`), pnpm `12.10.1`. Workspaces are `apps/*` only — there is no
`packages/` directory and no inter-app runtime dependencies. TypeScript is
pinned to `6.0.3` (Nest CLI needs the compiler API TypeScript 7 removed).
Linting/formatting: Oxlint + Oxfmt everywhere. Git hooks: Husky, lint-staged,
commitlint, `pnpm test` on pre-push.

| Application     | Path         | Stack                           | Port | Status             |
| --------------- | ------------ | ------------------------------- | ---- | ------------------ |
| API             | `apps/api`   | NestJS 12, Fastify, SWC, ESM    | 3001 | Active development |
| Web (customer)  | `apps/web`   | Next.js 16 App Router, React 19 | 3000 | Bare scaffold      |
| Admin dashboard | `apps/admin` | Vite 8, React 19                | 5173 | Bare scaffold      |

Frontends contain no API client code; client→API communication is not
implemented. No database, no authentication/authorization, no shared types —
the API is stateless beyond Redis.

## API Architecture (`apps/api`)

Entry point `src/main.ts` — all bootstrap HTTP configuration (Fastify
`trustProxy`, `bodyLimit`, request IDs, global `api` prefix, URI versioning
`/api/v1`, CORS) lives in its `bootstrap` function and must not be extracted.

Key layers (Node `#` subpath import aliases, see `apps/api/package.json`):

- `src/modules/<feature>/` — feature code. Currently one feature:
  `enrollments` (OTP challenge + verify, no SMS, no registration yet).
- `src/shared/` — cross-cutting infrastructure: `config` (Zod env validation
  - namespaced `registerAs` factories), `logging` (Pino via nestjs-pino),
    `redis`, errors, filters, interceptors, pipes, HTTP helpers.
- `src/i18n/{en,fa}/` — `@nestjs/i18n` catalogs (`en` default, `fa` Persian);
  all user-facing messages must exist in both locales.

Core contracts:

- **Configuration:** `process.env` is read exactly once, in
  `src/shared/config/env/env.config.ts` (Zod, fail-fast, ADR-004); env files
  live in `apps/api/env/` (`.env.example` is canonical, gitignored otherwise).
  Access config through factories + `ConfigService`, never `process.env`.
- **Responses:** success envelope (ADR-011) and RFC 9457 Problem Details
  errors carrying the request ID (ADR-010), both application-global with
  contract tests. Localized `message` / `title` / `detail` (en/fa); error
  codes and machine-readable values are language-independent.
- **Validation:** `ZodValidationPipe` for body/param/query; Zod messages are
  bilingual.
- **Redis:** global `RedisModule` in `src/shared/redis/` (ADR-012/013) — one
  ioredis 6 client, `RedisService` abstraction, non-blocking startup,
  `degraded` health (HTTP 200) when unreachable. All keys via `buildRedisKey`
  from a co-located keys file; root namespace `neo-bank`, pattern
  `<app>:<module>:<feature>:<resource>:<identifier>`. Multi-step Redis flows
  use atomic Lua scripts. Consumers: enrollments OTP storage, global rate
  limiting (ADR-015, `@nestjs/throttler` v6, two policies, Redis-backed
  storage with an atomic Lua block-check script, fail-closed on Redis
  failure).
- **Logging:** Pino only (ADR-008/009); JSON in production, pretty in dev,
  `LOG_PRETTY` override; never `console.log`, never log OTPs/secrets.
- **Swagger:** development-only at `/docs` (ADR-014), schemas from Zod.

## Testing

- Vitest unit tests (AAA) + e2e + Redis integration (`pnpm test:redis`).
- Integration/e2e use Testcontainers (`apps/api/test/testcontainers.ts`) —
  isolated `redis:8.2-alpine` per test file, dynamic ports, no manual
  Compose.
- Vitest resolves `#` aliases via `apps/api/test/subpath-import-aliases.ts`;
  new aliases must be added there and in `apps/api/package.json`.
- Web and admin have no test setup.

## Infrastructure

- **Docker:** dev/prod Compose stacks in `docker/` (base `docker/compose.yml` +
  `docker/compose.app.dev.yml` / `docker/compose.app.prod.yml` /
  `docker/compose.prod.all.yml`, interpolation env files in `docker/env/`,
  per-app images via `turbo prune`), PostgreSQL + Redis; dev Redis is Redis
  Stack with bundled Redis Insight :8001 (ADR-020); dev-only MockServer :1080
  for resilience testing against simulated downstream failures (ADR-024).
  Ops: `docs/docker.md`.
- **Monitoring:** independent Compose stack (ADR-022) — Grafana :3002 (loopback),
  Loki 3.7.9, Grafana Alloy 1.21.0 collecting container stdout → Loki.
  Ops: `docs/observability/README.md`; roadmap: `docs/observability/roadmap.md`.
- **Planned:** database, SMS provider, auth, CI, metrics/tracing/alerting.

## Conventions (summary — details in AGENTS.md files)

- Happy path first; guard clauses over nesting; no magic strings (named
  constants); no `any`/unsafe assertions; no unrelated refactoring.
- Bilingual delivery (en/fa) is mandatory for every user-facing message.
- One user prompt = one feature = one record in `prompts/`; ADR-first
  workflow for significant decisions (`DECISIONS.md`); context-blind judge
  review after each atomic implementation unit (`docs/judge-findings.md`).
- Multi-agent development workflow (ADR-023): four subagents (`project-explorer`,
  `code-reviewer`, `code-security-analyzer`, `documentation-writer`) defined in
  `.agents/definitions/` and generated for ZCode + Claude Code by
  `node scripts/agents/sync.mjs`; review gates, context-delivery, and session
  initialization rules in root `AGENTS.md` and
  `.agents/workflows/development-workflow.md`.
- Documentation Update Triggers table in root `AGENTS.md` governs doc updates.

## Documentation Index

| Document                                    | Purpose                                                    |
| ------------------------------------------- | ---------------------------------------------------------- |
| `AGENTS.md` (root + per app)                | Agent instructions and conventions                         |
| `apps/*/ONBOARDING.md`                      | Developer onboarding, stack tables, env vars, commands     |
| `docs/architecture.md`                      | Detailed architecture, boundaries, workspace relationships |
| `docs/current-state.md`                     | Feature/state snapshot (verified per feature)              |
| `DECISIONS.md`                              | ADR-001…ADR-024, all Accepted                              |
| `docs/docker.md`                            | Docker stacks: setup, env files, commands                  |
| `docs/observability/README.md`              | Monitoring stack operations                                |
| `docs/observability/manual-testing.md`      | Reproducible monitoring verification scenarios             |
| `docs/observability/roadmap.md`             | Observability roadmap (metrics/tracing/alerting)           |
| `docs/security-otp-enrollment.md`           | Security assessment of the OTP enrollment flow             |
| `docs/judge-findings.md`                    | AI code-review findings tracker                            |
| `DEFERRED.md`                               | Mandated deferred work registry                            |
| `prompts/`                                  | Sequential per-feature request + implementation records    |
| `.agents/rules/`, `.agents/skills/`         | Agent rules and skills (tooling)                           |
| `.agents/README.md`                         | Multi-agent system: setup, platform integration, extension |
| `.agents/workflows/development-workflow.md` | Mandatory multi-agent development workflow (ADR-023)       |
| `.agents/schemas/`                          | Canonical subagent report templates                        |
