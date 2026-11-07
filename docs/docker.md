# Docker

Docker support for the monorepo: development environments with hot reloading
and production images for all three applications, plus PostgreSQL and Redis
as infrastructure services.

**Note on automated testing (ADR-016):** Integration and e2e tests use
Testcontainers (`apps/api/test/testcontainers.ts`) to start isolated
`redis:8.2-alpine` (and future `postgres:17.6-alpine`) containers per test
file with dynamic ports — no manual `docker compose up` required. The
development Compose stack (`compose.dev.yml`) remains for local development
(hot reloading, persistent volumes, multi-service stack).

## Files

| File                                   | Purpose                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------ |
| `apps/<app>/Dockerfile.dev`            | Development image (dependencies only; source is bind-mounted)                              |
| `apps/<app>/Dockerfile.prod`           | Production image (multi-stage, non-root, minimal)                                          |
| `apps/<app>/Dockerfile.*.dockerignore` | Per-Dockerfile build-context ignores (used _instead of_ the root file, not merged with it) |
| `compose.dev.yml`                      | Development stack (`neo-bank-dev` project)                                                 |
| `compose.prod.yml`                     | Production stack (`neo-bank-prod` project)                                                 |
| `.dockerignore`                        | Root build-context ignore                                                                  |
| `.env.docker.example`                  | Interpolation values for both Compose files                                                |

## Environment Files

Two distinct mechanisms, deliberately kept separate:

- **Interpolation** — `.env.docker` (copy from `.env.docker.example`) provides
  values for `${VARIABLE}` placeholders in the Compose files themselves:
  host ports, PostgreSQL credentials, and the Redis password. Pass it
  explicitly with `--env-file .env.docker`.
- **Container configuration** — `env_file:` injects the applications' own env
  files into their containers: `apps/api/env/.env.development` (dev) and
  `apps/api/env/.env.production` (prod, create it from `apps/api/env/.env.example`).
  Frontends currently have no env files.

Values that depend on the Docker topology (the `redis` service hostname and
the Redis password in production) are set under `environment:` in the Compose
files, which takes precedence over `env_file`. Never bake env files into
images — they are excluded from every build context.

## Commands

Run from the repository root.

**Development (hot reloading):**

```sh
cp .env.docker.example .env.docker          # adjust ports/credentials
docker compose --env-file .env.docker -f compose.dev.yml up --build
```

**Production:**

```sh
cp .env.docker.example .env.docker          # set POSTGRES_PASSWORD + REDIS_PASSWORD
cp apps/api/env/.env.example apps/api/env/.env.production
docker compose --env-file .env.docker -f compose.prod.yml up --build -d
```

**Rebuild after dependency changes:**

```sh
docker compose --env-file .env.docker -f compose.dev.yml build
docker compose --env-file .env.docker -f compose.prod.yml build
```

**Stop / inspect:**

```sh
docker compose --env-file .env.docker -f compose.dev.yml down
docker compose --env-file .env.docker -f compose.prod.yml logs -f api
docker compose --env-file .env.docker -f compose.prod.yml ps
```

Add `-v` to `down` to remove the PostgreSQL data volume (development data
lives in the named `postgres_dev_data` / `postgres_prod_data` volumes).

## Ports

| Service    | Container            | Host (interpolation variable)       | Exposed in production          |
| ---------- | -------------------- | ----------------------------------- | ------------------------------ |
| API        | 3001                 | `${API_PORT}` (default 3001)        | yes                            |
| Web        | 3000                 | `${WEB_PORT}` (default 3000)        | yes                            |
| Admin      | 5173 dev / 8080 prod | `${ADMIN_PORT}` (default 5173/8080) | yes                            |
| PostgreSQL | 5432                 | `${POSTGRES_PORT}` (default 5432)   | **no** (internal network only) |
| Redis      | 6379                 | `${REDIS_PORT}` (default 6379)      | **no** (internal network only) |

During development, reach PostgreSQL and Redis on `localhost` with the host
ports above; in production they are reachable only from containers on the
internal network, by service name (`postgres`, `redis`).

## Data Persistence

- **PostgreSQL** persists in a named Docker volume
  (`postgres_dev_data` / `postgres_prod_data`), so data survives container
  recreation.
- **Redis has no volume at all** — persistence is disabled
  (`--save "" --appendonly no`) and data is treated as ephemeral. Everything
  stored in Redis is lost when its container is recreated. This is
  intentional: nothing in the current architecture relies on Redis data
  surviving a restart.

In production Redis requires authentication (`--requirepass` with
`REDIS_PASSWORD` from `.env.docker`, passed to the API through its
`REDIS_PASSWORD` configuration).

## Hot Reloading (Development)

Source directories are bind-mounted into the containers; the images contain
only the installed dependencies, and named volumes shield the container
`node_modules` from the host's. Editing a file on the host triggers the
existing watch processes (NestJS `--watch`, `next dev`, `vite`) inside the
container. If dependencies change, rebuild the images so the new lockfile is
installed into the volumes.

## Production Image Notes

- Multi-stage builds with `turbo prune --docker`, so each image contains only
  its own workspace slice (no unrelated application source, no devDependencies).
- All containers run as non-root users; application root filesystems are
  read-only with writable `/tmp` only.
- Base images are version-pinned (`node:24.20.0-slim`, `postgres:17.6-alpine`,
  `redis:8.2-alpine`, `nginxinc/nginx-unprivileged:1.29-alpine`).
- The admin runtime is plain nginx (SPA fallback, hashed-asset caching,
  baseline security headers) — no Node.js in that final image.
- Next.js uses `output: 'standalone'` for a minimal server bundle.
