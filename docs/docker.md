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
| `compose.monitoring.yml`               | Monitoring stack: Grafana, Loki, Alloy (`neo-bank-monitoring` project)                     |
| `monitoring/`                          | Config as code for the monitoring stack (Alloy pipeline, Loki, Grafana provisioning)       |
| `.dockerignore`                        | Root build-context ignore                                                                  |
| `.env.docker.example`                  | Template for the interpolation files below                                                 |
| `.env.docker.dev`                      | Interpolation values for `compose.dev.yml` (gitignored)                                    |
| `.env.docker.prod`                     | Interpolation values for `compose.prod.yml` (gitignored)                                   |
| `.env.monitoring.example`              | Template for `.env.monitoring`, the monitoring stack's interpolation file (gitignored)     |

## Environment Files

Two distinct mechanisms, deliberately kept separate — and development and
production use separate interpolation files so credentials never leak across
environments:

- **Interpolation** — `.env.docker.dev` (development) and `.env.docker.prod`
  (production), each copied from `.env.docker.example`, provide values for
  `${VARIABLE}` placeholders in the Compose files themselves: host ports,
  PostgreSQL credentials, and the Redis password. Pass them explicitly with
  `--env-file .env.docker.dev` or `--env-file .env.docker.prod`. The
  monitoring stack uses its own file, `.env.monitoring` (copied from
  `.env.monitoring.example`): the Grafana admin password, the Grafana host
  port, and the host's Docker-socket group ID (see the monitoring section).
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
cp .env.docker.example .env.docker.dev      # adjust ports/credentials
pnpm docker:dev                             # = docker compose --env-file .env.docker.dev -f compose.dev.yml up --build -d
```

**Production:**

```sh
cp .env.docker.example .env.docker.prod     # set POSTGRES_PASSWORD + REDIS_PASSWORD
cp apps/api/env/.env.example apps/api/env/.env.production
pnpm docker:prod                            # = docker compose --env-file .env.docker.prod -f compose.prod.yml up --build -d
```

**Rebuild after dependency changes:**

```sh
docker compose --env-file .env.docker.dev -f compose.dev.yml build
docker compose --env-file .env.docker.prod -f compose.prod.yml build
```

**Stop / inspect:**

```sh
pnpm docker:dev:down
pnpm docker:prod:down
docker compose --env-file .env.docker.prod -f compose.prod.yml logs -f api
docker compose --env-file .env.docker.prod -f compose.prod.yml ps
```

Add `-v` to `down` to remove the PostgreSQL data volume (development data
lives in the named `postgres_dev_data` / `postgres_prod_data` volumes).

**Monitoring (independent of both application stacks):**

```sh
cp .env.monitoring.example .env.monitoring   # set GRAFANA_ADMIN_PASSWORD + DOCKER_GID
pnpm docker:monitoring                       # Grafana, Loki, Alloy in the background
pnpm docker:monitoring:logs                  # follow monitoring container logs
pnpm docker:monitoring:down
```

See [`docs/observability/README.md`](./observability/README.md) for the full
operational guide and the Persian learning guide for how the pipeline works.

## Ports

| Service       | Container            | Host (interpolation variable)              | Exposed in production                    |
| ------------- | -------------------- | ------------------------------------------ | ---------------------------------------- |
| API           | 3001                 | `${API_PORT}` (default 3001)               | yes                                      |
| Web           | 3000                 | `${WEB_PORT}` (default 3000)               | yes                                      |
| Admin         | 5173 dev / 8080 prod | `${ADMIN_PORT}` (default 5173/8080)        | yes                                      |
| PostgreSQL    | 5432                 | `${POSTGRES_PORT}` (default 5432)          | **no** (internal network only)           |
| Redis         | 6379                 | `${REDIS_PORT}` (default 6379)             | **no** (internal network only)           |
| Redis Insight | 8001                 | `${REDIS_INSIGHT_PORT}` (default 8001)     | **no** (development only)                |
| Grafana       | 3000                 | `127.0.0.1:${GRAFANA_PORT}` (default 3002) | **no** (monitoring stack; loopback only) |
| Loki          | 3100                 | `127.0.0.1:${LOKI_PORT}` (default 3100)    | **no** (monitoring stack; loopback only) |

The monitoring ports are bound to `127.0.0.1` explicitly: Grafana (UI) and
Loki (for LogQL exercises via curl) are reachable from the host only, never
from the network. Alloy has no port on the host at all — its debug UI is
reachable only inside the monitoring network.

## Container Log Rotation

Every service in all three Compose files sets bounded json-file logging
(`max-size: 10m`, `max-file: 3`) through the shared `x-logging` anchor, so a
noisy container cannot grow the host disk without limit (each container
holds at most ~30 MB of log files; rotation applies per file, so up to three
files per container). Without this, the Docker default keeps logs forever.

## Monitoring Stack

The monitoring stack (`compose.monitoring.yml`, ADR-022) runs three
version-pinned services on an isolated network, fully independent of the
application stacks: Grafana Alloy collects the dev/prod containers' logs
through the Docker socket, Loki stores them (7-day retention, named volume),
and Grafana serves the provisioned dashboard at
`http://localhost:${GRAFANA_PORT:-3002}`. Details, operations, and
troubleshooting: [`docs/observability/README.md`](./observability/README.md);
the Persian learning guide explains the whole pipeline. The stack requires
`DOCKER_GID` in `.env.monitoring` (the host docker group id — find it with
`stat -c %g /var/run/docker.sock`) so Alloy can read the socket without
running as root. Because Alloy tails the dev/prod containers through the
Docker API, the monitoring stack works regardless of which application
stacks are up, and stopping monitoring never affects the applications.

## Structured Logs in Dev Containers

The API emits `pino-pretty` (human-formatted) logs whenever `APP_ENV=development` — except when `LOG_PRETTY=false` is set. The development
Compose stack sets `LOG_PRETTY: 'false'` for the `api` service only, so the
containerized API logs structured JSON that the centralized pipeline parses
(level labels, timestamps), while host-side `pnpm dev` keeps the pretty
format. The variable is optional and documented in `apps/api/env/.env.example`
(ADR-022).

## Redis Insight

The development stack's `redis` service runs `redis/redis-stack:latest`
(ADR-020), which bundles Redis Insight. When the dev stack is up, Insight is
at `http://localhost:${REDIS_INSIGHT_PORT}` (default 8001). The API logs the
URL at startup (`Redis Insight: http://localhost:8001`) because the dev
Compose stack injects it as `REDIS_INSIGHT_URL`; environments without Insight
(local non-Docker development, production) never log it. The production stack
keeps the version-pinned standalone `redis:8.2-alpine` image.

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
`REDIS_PASSWORD` from its interpolation file, passed to the API through its
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

## API Startup URLs

After a successful listen, the API logs its API address
(`http://<address>:<port>/api/v1`) and — in development only — the Swagger UI
address (`http://<address>:<port>/docs`) using the Pino logger. The protocol
is always `http`: the Fastify adapter is created without HTTPS options and no
reverse proxy fronts the API, so no external URL is invented. For the wildcard
bind address (`HOST=0.0.0.0`, the default in `apps/api/env/.env.development`
and the prod Compose override), the log lists `127.0.0.1` plus the
non-internal interface addresses. Inside a container those interface addresses
are container-internal; the host-published port (`API_PORT`) is not knowable
from inside the container and is never claimed.
