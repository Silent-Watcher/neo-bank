# 037 — Environment Files Configuration Governance

## Original User Request

Task 4 of the four-task master prompt: populate the existing environment files
with values grounded in the actual project configuration (without inventing or
copying credentials), and establish a persistent rule preventing future agents
from unnecessarily modifying existing environment variables. Initial population
is a one-time activity; afterwards existing variables and values are stable.

## Implementation

- **`apps/api/env/.env.development`** (local, gitignored): populated from the
  blank copy of `.env.example`, preserving every variable name and the
  canonical comment blocks. Values: `APP_ENV=development`, `HOST=0.0.0.0`
  (works host-local and in the Compose container), `PORT=3001`,
  `CORS_ORIGIN=http://localhost:3000` (local web dev server), `TRUST_PROXY=false`,
  `BODY_LIMIT=2097152`, `LOG_LEVEL=info`, `LOG_PRETTY=true` (Compose overrides
  to `false` for the JSON pipeline), `REDIS_URL=redis://127.0.0.1:6380`
  (dev stack's host-published Redis; Compose overrides the container value),
  `REDIS_USERNAME=default`, and the six Redis tuning keys set to their
  schema-default values (`REDIS_DB=0`, `REDIS_TLS=false`, connect 10000,
  command 5000, retries 3, shutdown 2000) — empty `KEY=` lines would reach the
  app as empty strings and fail schema validation (judge finding TF4-1).
  Rate-limit and enrollments numbers at schema defaults.
  `REDIS_PASSWORD` left empty with a comment identifying that it must
  match `docker/env/.env.docker.dev`; `ENROLLMENTS_OTP_HMAC_SECRET` set to a
  locally generated dev-only value (logged in `docs/ai-decisions.md` §1);
  `REDIS_INSIGHT_URL` / `MOCKSERVER_*` left empty (presence-gated startup-log
  behavior by design; the shared `optionalHttpUrlEnv` helper normalizes
  blanks to unset).
- **`apps/api/env/.env.production`** (local, gitignored): populated with
  deployment-independent values only — `APP_ENV=production`, `HOST=0.0.0.0`,
  `PORT=3001`, `TRUST_PROXY=false` (matches the shipped proxy-less Compose
  topology; an in-file comment states it may be set `true` only behind a real
  terminating proxy — judge finding TF4-2 replaced the earlier `true`
  assumption), `BODY_LIMIT=2097152`, `LOG_LEVEL=info`, `LOG_PRETTY=false`,
  `REDIS_URL=redis://redis:6379` (matches the Compose topology),
  `REDIS_USERNAME=default`, and the same six explicit Redis tuning defaults.
  `CORS_ORIGIN`, `REDIS_PASSWORD`, and `ENROLLMENTS_OTP_HMAC_SECRET` left
  intentionally empty with deployment instructions: the application refuses to
  start until the deployment provides them (schema-enforced fail-fast), and no
  agent may fabricate production credentials.
- **Root `AGENTS.md`**: new `#### Environment Variable Stability` subsection
  under Environment File Synchronization with the ten stability rules
  (preserve names/values, no preference-driven overwrites or renames without
  approval, add/remove only when genuinely required, full sync, no
  duplication, no secret exposure, approval gate for justified changes) plus
  the "population is one-time; afterwards values are stable" caveat.
- **`apps/api/src/shared/config/env/schema/enrollments.env.ts`**: removed the
  locally duplicated `positiveSafeInteger` copy in favor of the identical
  shared helper in `validation-helpers.ts` (behavior-preserving DRY fix,
  approved as part of the task plan).
- **`docs/ai-decisions.md`**: first log entry (dev HMAC placeholder strategy).

## Decisions

- Secrets are never invented or copied: dev `REDIS_PASSWORD` is identified
  ("must match docker/env/.env.docker.dev") instead of copied; production
  secrets stay empty by design so fail-fast protects incomplete deployments.
- `TRUST_PROXY=false` in production (final value after judge finding TF4-2):
  the shipped Compose topology exposes the API port directly with no reverse
  proxy, so trusting proxy headers would let clients spoof their IP and
  defeat per-IP rate limiting. The in-file comment states `true` may be set
  only where a real proxy terminates client connections.
- `.env.example` remains the untouched canonical template; the populated files
  are the gitignored local ones — consistent with the existing tracking model.
- Test env files (`.env.test`, `.env.redis-test`) were not touched; validation
  confirmed their 15-name subset is schema-safe (everything omitted is
  optional or defaulted).

## Validation (delegated subagent report)

- Variable-name consistency: `.env.development`/`.env.production` have exactly
  the same 27-name set as `.env.example`; `.env.test`/`.env.redis-test` have
  an identical 15-name subset (12 omissions, all optional/defaulted).
- Schema coverage: 27 schema keys across the five `*.env.ts` files match
  `.env.example` bidirectionally — no gaps either direction.
- `docker compose config --quiet` renders: dev (`.env.docker.dev`) and prod
  (`.env.docker.prod`) app stacks both exit 0 (parse-level; no daemon needed).
- `pnpm format`: exit 0, no file modified (enrollments.env.ts hash unchanged).
- `pnpm lint`: exit 0; 0 errors, 42 warnings — all pre-existing spec-file
  findings, none in changed files.
- `pnpm typecheck`: 3/3 workspaces pass.
- API unit suite (`vitest run` in apps/api): **285/285 passed**, including the
  9 unchanged `enrollments.env.spec.ts` tests against the refactored schema.
- Not run (and not claimed): runtime boot of the API against the populated
  files — the approved plan left one-shot boot validation out; the schema
  coverage and unit suite cover the changed logic.

## Notes

- The governance rule now governs Tasks 1 and 3 of the same initiative (both
  will add environment variables under it).
- Docs-only + env-file + one-line-schema changes; the review gates cover the
  schema import refactor (see judge-findings Wave 7).
- Not committed; awaiting explicit approval.
