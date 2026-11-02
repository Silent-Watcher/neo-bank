# Docker Infrastructure

## User Request

The user asked for complete Docker infrastructure for the monorepo:
development and production Dockerfiles for API (NestJS), web (Next.js), and
admin (Vite + React); `compose.dev.yml` / `compose.prod.yml` with PostgreSQL
and Redis; monorepo-aware build contexts (`turbo prune`); hardened, minimal,
non-root production images; hot reloading in development; env files and
Compose interpolation without duplicated variables; Docker ignore files
including Dockerfile-specific ones; a persistent PostgreSQL volume; Redis
with **no persistence volume at all** (ephemeral by design); usage
documentation; and validation of configs, builds, and runtime behavior.

## Implementation

- **Dev images** (`apps/*/Dockerfile.dev`): `node:24.20.0-slim`, corepack
  pnpm, workspace manifests baked in with a cache-mounted pnpm store; source
  arrives via bind mounts, named volumes shield container `node_modules`
  from the host's, and the existing `pnpm dev` scripts provide hot reloading.
  Admin gets `--host 0.0.0.0` through the Compose command (no app config
  change).
- **Prod images** (`apps/*/Dockerfile.prod`): multi-stage
  prune → build → runtime. `turbo prune --docker` isolates each app's
  workspace slice; the API runtime carries dist + `--prod` dependencies; the
  web runtime is the Next.js standalone output (`output: 'standalone'` added
  to `next.config.ts` — the only app-code change, required for a minimal
  runtime); the admin runtime is `nginxinc/nginx-unprivileged` with SPA
  fallback, hashed-asset caching, and security headers (`apps/admin/nginx.conf`).
  All runners are non-root, use exec-form CMD, and run with read-only root
  filesystems (writable tmpfs only). Images are version-pinned.
- **Compose** (`compose.dev.yml`, `compose.prod.yml`): interpolation from
  `.env.docker` (`${VAR:-default}` ports, `${VAR:?}` required credentials),
  app config via `env_file` (never baked into images), `depends_on` +
  `service_healthy` for postgres/redis, health checks for every service.
  Production: `restart: unless-stopped`, edge + internal (host-isolated)
  networks, PostgreSQL/Redis not exposed, Redis with `--requirepass` matching
  the API's `REDIS_PASSWORD`. PostgreSQL persists in named volumes; Redis has
  no volume and runs with `--save "" --appendonly no` in both environments.
- **Ignores**: root `.dockerignore` plus six Dockerfile-specific ignore
  files (they replace, not merge, the root file); dev contexts reduced to
  manifests only; prod contexts exclude unrelated app source; env files are
  excluded everywhere.
- **Config**: `pnpm-workspace.yaml` `allowBuilds` denies `@scarf/scarf`
  (NestJS telemetry) so non-interactive installs do not fail with
  `ERR_PNPM_IGNORED_BUILDS`; `.gitignore` exempts `.env.docker.example`.
- **Docs**: `docs/docker.md` (commands, env selection, ports, persistence
  semantics) with a pointer from `README.md`; `docs/current-state.md`
  updated.

## Validation (actually executed)

- `docker compose --env-file .env.docker -f compose.dev.yml config` — passed
  (both files); missing required credentials produce the intended
  `${VAR:?}` interpolation errors.
- All six images built successfully. Building surfaced and fixed three real
  issues: the `turbo prune` output path (`/repo/out/...`, not `/out`), pnpm's
  `ERR_PNPM_IGNORED_BUILDS` in non-interactive installs (fixed by denying
  `@scarf/scarf` build scripts in `pnpm-workspace.yaml`), and a pnpm `--`
  passthrough quirk in the admin dev command.
- **Development stack ran fully**: all five services healthy; `/health`
  returned `ok` with `redis: up` (this exposed and fixed a real credential
  mismatch — see below); web and admin served 200; hot reloading verified
  end-to-end for admin and web (host edit → container serves the change →
  revert); the volume set is exactly `postgres_dev_data` plus four
  `node_modules` shields — **no Redis volume**.
- **Production stack ran fully**: all five services healthy; API health `ok`
  with Redis authenticated via `--requirepass`; postgres/redis ports
  internal-only; all three apps verified running as non-root users
  (`neo`, `neo`, `nginx`); no env files present inside any image.
  Image sizes: api 558 MB, web 436 MB, admin 81.9 MB.
- The environment's Docker Hub access intermittently returned HTTP 403 for
  blob downloads; the two missing infra images were obtained with patient
  retries (`postgres:17.6-alpine`, `redis:8.2-alpine`).
- Both stacks torn down afterwards; no containers or volumes left running.

### Credential fix found by runtime verification

The host's `apps/api/env/.env.development` carries real Redis credentials
for the developer's local password-protected Redis, which produced
`WRONGPASS` against the container Redis. Resolution: Redis runs with
`--requirepass ${REDIS_PASSWORD}` in **both** environments (the value comes
from `.env.docker`), and the Compose `environment` block overrides the API's
`REDIS_USERNAME`/`REDIS_PASSWORD` so container topology always wins over
host-local values in the app env files.
