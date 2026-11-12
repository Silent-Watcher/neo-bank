# Docker

Docker support for the monorepo: development environments with hot reloading
and production images for all three applications, plus PostgreSQL and Redis
as infrastructure services and a development-only MockServer for resilience
testing (ADR-024).

**Note on automated testing (ADR-016):** Integration and e2e tests use
Testcontainers (`apps/api/test/testcontainers.ts`) to start isolated
`redis:8.2-alpine` (and future `postgres:17.6-alpine`) containers per test
file with dynamic ports — no manual `docker compose up` required. The
development Compose stack remains for local development
(hot reloading, persistent volumes, multi-service stack).

## Files

| File                                   | Purpose                                                                                                         |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `apps/<app>/Dockerfile.dev`            | Development image (dependencies only; source is bind-mounted)                                                   |
| `apps/<app>/Dockerfile.prod`           | Production image (multi-stage, non-root, minimal)                                                               |
| `apps/<app>/Dockerfile.*.dockerignore` | Per-Dockerfile build-context ignores (used _instead of_ the root file, not merged with it)                      |
| `docker/compose.yml`                   | Development orchestrator: `include:` of the dev app stack and the monitoring stack into one `docker compose up` |
| `docker/compose.app.dev.yml`           | Dev app stack: hot-reloading apps plus PostgreSQL, Redis, and MockServer (dev-only, ADR-024) (`neo-bank-dev`)   |
| `docker/compose.app.prod.yml`          | Production app stack: hardened images, internal networks (`neo-bank-prod` project)                              |
| `docker/compose.prod.all.yml`          | Production orchestrator: `include:` of the production app stack and the monitoring stack                        |
| `docker/compose.monitoring.yml`        | Monitoring stack: Grafana, Loki, Alloy (`neo-bank-monitoring` project)                                          |
| `monitoring/`                          | Config as code for the monitoring stack (Alloy pipeline, Loki, Grafana provisioning)                            |
| `.dockerignore`                        | Root build-context ignore                                                                                       |
| `docker/env/.env.docker.example`       | Template for the interpolation files below                                                                      |
| `docker/env/.env.docker.dev`           | Interpolation values for the development Compose files (gitignored)                                             |
| `docker/env/.env.docker.prod`          | Interpolation values for the production Compose files (gitignored)                                              |
| `docker/env/.env.monitoring.example`   | Template for `docker/env/.env.monitoring`, the monitoring stack's interpolation file (gitignored)               |

All Compose files live in `docker/`; the interpolation env files they consume
live in `docker/env/`.

## Environment Files

Two distinct mechanisms, deliberately kept separate — and development and
production use separate interpolation files so credentials never leak across
environments:

- **Interpolation** — `docker/env/.env.docker.dev` (development) and
  `docker/env/.env.docker.prod` (production), each copied from
  `docker/env/.env.docker.example`, provide values for `${VARIABLE}`
  placeholders in the Compose files themselves: host ports, PostgreSQL
  credentials, and the Redis password. Pass them explicitly with
  `--env-file docker/env/.env.docker.dev` or
  `--env-file docker/env/.env.docker.prod`. The monitoring stack uses its own
  file, `docker/env/.env.monitoring` (copied from
  `docker/env/.env.monitoring.example`): the Grafana admin password, the
  Grafana host port, and the host's Docker-socket group ID (see the
  monitoring section).
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
cp docker/env/.env.docker.example docker/env/.env.docker.dev   # adjust ports/credentials
pnpm docker:dev                             # = docker compose --env-file docker/env/.env.docker.dev --env-file docker/env/.env.monitoring -f docker/compose.yml up --build -d
```

**Production:**

```sh
cp docker/env/.env.docker.example docker/env/.env.docker.prod   # set POSTGRES_PASSWORD + REDIS_PASSWORD
cp apps/api/env/.env.example apps/api/env/.env.production
pnpm docker:prod                            # = docker compose --env-file docker/env/.env.docker.prod --env-file docker/env/.env.monitoring -f docker/compose.prod.all.yml up --build -d
```

**Rebuild after dependency changes:**

```sh
docker compose --env-file docker/env/.env.docker.dev -f docker/compose.app.dev.yml build
docker compose --env-file docker/env/.env.docker.prod -f docker/compose.app.prod.yml build
```

**Stop / inspect:**

```sh
pnpm docker:dev:down
pnpm docker:prod:down
docker compose --env-file docker/env/.env.docker.prod -f docker/compose.app.prod.yml logs -f api
docker compose --env-file docker/env/.env.docker.prod -f docker/compose.app.prod.yml ps
```

Add `-v` to `down` to remove the PostgreSQL data volume (development data
lives in the named `postgres_dev_data` / `postgres_prod_data` volumes).

**Monitoring (independent of both application stacks):**

```sh
cp docker/env/.env.monitoring.example docker/env/.env.monitoring   # set GRAFANA_ADMIN_PASSWORD + DOCKER_GID
pnpm docker:monitoring                       # Grafana, Loki, Alloy in the background
pnpm docker:monitoring:logs                  # follow monitoring container logs
pnpm docker:monitoring:down
```

See [`docs/observability/README.md`](./observability/README.md) for the full
operational guide.

## Ports

| Service       | Container            | Host (interpolation variable)              | Exposed in production                    |
| ------------- | -------------------- | ------------------------------------------ | ---------------------------------------- |
| API           | 3001                 | `${API_PORT}` (default 3001)               | yes                                      |
| Web           | 3000                 | `${WEB_PORT}` (default 3000)               | yes                                      |
| Admin         | 5173 dev / 8080 prod | `${ADMIN_PORT}` (default 5173/8080)        | yes                                      |
| PostgreSQL    | 5432                 | `${POSTGRES_PORT}` (default 5432)          | **no** (internal network only)           |
| Redis         | 6379                 | `${REDIS_PORT}` (default 6379)             | **no** (internal network only)           |
| Redis Insight | 8001                 | `${REDIS_INSIGHT_PORT}` (default 8001)     | **no** (development only)                |
| MockServer    | 1080                 | `127.0.0.1:${MOCKSERVER_PORT}` (def. 1080) | **no** (development only)                |
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

The monitoring stack (`docker/compose.monitoring.yml`, ADR-022) runs three
version-pinned services on an isolated network, fully independent of the
application stacks: Grafana Alloy collects the dev/prod containers' logs
through the Docker socket, Loki stores them (7-day retention, named volume),
and Grafana serves the provisioned dashboard at
`http://localhost:${GRAFANA_PORT:-3002}`. Details, operations, and
troubleshooting: [`docs/observability/README.md`](./observability/README.md).
The stack requires
`DOCKER_GID` in `docker/env/.env.monitoring` (the host docker group id — find it with
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

## MockServer (development only)

The development stack runs [MockServer](https://www.mock-server.com/)
(`mockserver/mockserver:9.2.0`, version-pinned, ADR-024), a development-only
HTTP mock for resilience testing: it simulates downstream service behavior —
timeouts, HTTP 5xx responses, delayed responses, failure-then-recovery
sequences — so resilience patterns around outbound integrations (bounded
timeouts, capped retries, failure handling, recovery) can be exercised
repeatably against a real HTTP endpoint. The service is defined only in
`docker/compose.app.dev.yml`; the production Compose files cannot inherit it,
and nothing in production changes.

**Run / stop** — MockServer is part of the dev app stack, so the usual
commands bring it up and tear it down:

```sh
pnpm docker:app:dev        # dev app stack (includes MockServer)
pnpm docker:dev            # dev orchestrator: app stack + monitoring
pnpm docker:app:dev:down   # stop the dev app stack
pnpm docker:dev:down       # stop the dev orchestrator
```

**Addresses** — control API, mocked endpoints, and dashboard share a single
port (`${MOCKSERVER_PORT}` in `docker/env/.env.docker.example`, default
`1080`):

- Host (developers on the machine): `http://localhost:1080`
- Compose network (containers): `http://mockserver:1080`

The dev Compose stack injects both addresses into the API as the optional
`MOCKSERVER_HOST_URL` / `MOCKSERVER_DOCKER_URL` variables, and the API startup
log prints them under a `MockServer:` section in development only — local
non-Docker development and production log nothing (same pattern as
`REDIS_INSIGHT_URL`, ADR-020).

**Availability and dashboard:** the distroless image ships a built-in
`HEALTHCHECK` probing `PUT /mockserver/status` (PUT, not GET, in 9.x), so
`docker compose ps` reports its health without a Compose override:

```sh
curl -X PUT http://localhost:1080/mockserver/status
```

A live dashboard (requests, expectations, verification) is at
`http://localhost:1080/mockserver/dashboard`.

**Usage examples** — register expectations with `PUT /mockserver/expectation`,
then point the dependency under test at one of the addresses above:

Always respond 500 for a path:

```sh
curl -X PUT http://localhost:1080/mockserver/expectation \
  -H 'Content-Type: application/json' \
  -d '{
    "httpRequest": { "method": "GET", "path": "/downstream/payments" },
    "httpResponse": { "statusCode": 500, "body": "simulated downstream failure" }
  }'
```

Delay every matching response by 5 seconds (`delay` inside `httpResponse`):

```sh
curl -X PUT http://localhost:1080/mockserver/expectation \
  -H 'Content-Type: application/json' \
  -d '{
    "httpRequest": { "method": "GET", "path": "/downstream/payments" },
    "httpResponse": {
      "statusCode": 200,
      "body": "{ \"ok\": true }",
      "delay": { "timeUnit": "SECONDS", "value": 5 }
    }
  }'
```

Fail once, then recover — an array body registers both expectations on the
same endpoint, and the times-limited expectation is matched first while it
still has remaining matches:

```sh
curl -X PUT http://localhost:1080/mockserver/expectation \
  -H 'Content-Type: application/json' \
  -d '[
    {
      "httpRequest": { "method": "GET", "path": "/downstream/payments" },
      "httpResponse": { "statusCode": 500 },
      "times": { "remainingTimes": 1, "unlimited": false }
    },
    {
      "httpRequest": { "method": "GET", "path": "/downstream/payments" },
      "httpResponse": { "statusCode": 200, "body": "{ \"ok\": true }" }
    }
  ]'
```

Expectations are stateful — reset everything, or clear scoped state, between
scenarios:

```sh
curl -X PUT http://localhost:1080/mockserver/reset
curl -X PUT "http://localhost:1080/mockserver/clear?type=expectations"
```

**Integration boundary:** running MockServer does not redirect any of the
API's outgoing requests — an application dependency must be explicitly
configured to target `http://mockserver:1080` (or the host address) before
anything is mocked. There is deliberately no `depends_on` relationship (the
API only logs the addresses and starts fine without the service), no volume
(every container restart starts with no expectations), and no role in the
automated test suite (Testcontainers tests never use the dev Compose stack,
ADR-016): MockServer is a manual, interactive development tool. The
monitoring stack's Alloy collects its stdout like any other dev container
(ADR-022).

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
address (`http://<address>:<port>/docs`) using the Pino logger. In development
the log can also contain a `MockServer:` section (`Host:` / `Docker:` lines,
ADR-024) and the Redis Insight URL (ADR-020); each appears only where the
development Compose stack injected the corresponding optional variable, so
local non-Docker development and production log neither. The protocol
is always `http`: the Fastify adapter is created without HTTPS options and no
reverse proxy fronts the API, so no external URL is invented. For the wildcard
bind address (`HOST=0.0.0.0`, the default in `apps/api/env/.env.development`
and the prod Compose override), the log lists `127.0.0.1` plus the
non-internal interface addresses. Inside a container those interface addresses
are container-internal; the host-published port (`API_PORT`) is not knowable
from inside the container and is never claimed.
