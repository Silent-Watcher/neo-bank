# Manual Testing: Centralized Logging Pipeline

Reproducible verification scenarios for the monitoring stack (ADR-022).
Each scenario states the steps and the expected result. The "Verification
log" at the bottom records what was actually executed, when, and with what
outcome — keep it updated when scenarios are re-run.

Prerequisites: `.env.monitoring` created (see README), Docker running.

Helper shorthand used below:

```sh
DM='docker compose --env-file .env.monitoring -f compose.monitoring.yml'
```

## S1 — Full pipeline: container → Alloy → Loki → Grafana

1. `pnpm docker:dev && pnpm docker:monitoring`
2. Wait until `docker ps` shows `neo-bank-dev-api-1` and the three
   `neo-bank-monitoring-*` containers up/healthy.
3. Generate traffic:
   ```sh
   curl -fsS http://localhost:3001/health
   curl -fsS -X POST http://localhost:3001/api/v1/enrollments/challenge \
     -H 'Content-Type: application/json' -d '{"phoneNumber":"09121234567"}'
   ```
4. Query Loki directly (loopback):
   ```sh
   curl -fsS 'http://127.0.0.1:3100/loki/api/v1/labels'
   # expect: ["container","env","level","service"]
   curl -fsS 'http://127.0.0.1:3100/loki/api/v1/query_range' \
     --data-urlencode 'query={service="api"}' --data-urlencode 'limit=5'
   # expect: JSON results with pino JSON lines as values
   ```
5. Open <http://localhost:3002>, sign in, open the "Neo Bank API Logs"
   dashboard: volume-by-level chart populated, All logs panel streaming API
   lines, Service dropdown listing `api`, `web`, `admin`, `postgres`,
   `redis`.

**Expected:** labels exist; `{service="api"}` returns structured JSON lines
with `"level":30`-style fields; Grafana dashboard shows the same data;
Level values appear as names (`info`, `error`) after the Alloy relabeling.

## S2 — Structured dev logging (LOG_PRETTY)

1. With only the dev stack up: `docker logs neo-bank-dev-api-1 | grep '^{' | head -1`.
2. On the host (outside Docker), `pnpm dev` in `apps/api` hits the same
   `APP_ENV=development` without `LOG_PRETTY`: log output is pino-pretty
   (colored single lines), not JSON.

**Expected:** the container logs JSON (Compose sets `LOG_PRETTY: 'false'`);
the host keeps pretty output. Unset `LOG_PRETTY` behavior is unchanged
everywhere else.

## S3 — Level filtering and request-ID investigation

1. Trigger an error-bearing request (e.g. an invalid payload → 400) and a
   successful one; note the `requestId` from a Problem Details response.
2. Query:
   ```sh
   curl -fsS 'http://127.0.0.1:3100/loki/api/v1/query_range' \
     --data-urlencode 'query={service="api", level=~"warn|error|fatal"}' \
     --data-urlencode 'limit=10'
   curl -fsS 'http://127.0.0.1:3100/loki/api/v1/query_range' \
     --data-urlencode 'query={service="api"} |= "<requestId>"' \
     --data-urlencode 'limit=10'
   ```
3. Repeat both queries in Grafana Explore.

**Expected:** the level query returns only warn+ lines; the request-ID query
returns every line (access log, service logs) that carries that `reqId` in
the body.

## S4 — Monitoring outage does not affect the API; recovery is lossless

1. With traffic flowing, `docker compose --env-file .env.monitoring -f compose.monitoring.yml stop loki`.
2. `curl -fsS http://localhost:3001/health` repeatedly; hit the API with
   requests for ~1 minute; check `pnpm docker:monitoring:logs` (Alloy shows
   push errors/retries, API unaffected).
3. `... start loki`; wait for `curl -fsS http://127.0.0.1:3100/ready` to
   return `ready`.
4. Query Loki for the outage window.

**Expected:** the API never errors because monitoring is down; after Loki
returns, the logs emitted during the outage appear (Alloy buffers/retries
in-memory; extremely long outages can exceed the buffer — that is a
documented boundary, not silent data loss).

## S5 — Collector restart does not duplicate or lose logs

1. Note a unique recent line (a fresh request's `requestId`).
2. `$DM restart alloy`; wait for healthy.
3. Query `{service="api"} |= "<that requestId>"`.

**Expected:** each distinct log line appears exactly once (Alloy's positions
file in `monitoring_alloy_data` resumes where it stopped; Loki itself
rejects exact duplicate entries).

## S6 — Persistence across restarts

1. Note a query result set (e.g. count of `{service="api"}` over the last
   hour).
2. `$DM restart loki grafana`; wait for readiness (`/ready`, Grafana
   `/api/health`).
3. Re-run the query; open Grafana.

**Expected:** identical data (named volumes), datasource + dashboard still
provisioned, UI-created dashboard changes retained.

## S7 — Container log rotation

1. `docker inspect neo-bank-dev-api-1 --format '{{.HostConfig.LogConfig}}'`
2. Write >10 MB into a container log (e.g. long-lived `docker exec` loops in
   a scratch container) or simply let the stack run; then check
   `/var/lib/docker/containers/<id>/` file count (Docker Desktop: inside the
   VM).

**Expected:** `json-file` with `max-size:10m max-file:3`; at most 3 log
files per container, oldest rotated away. Monitoring services carry the
same config.

## S8 — Scope: no self-ingestion, no foreign containers

1. `curl -fsS 'http://127.0.0.1:3100/loki/api/v1/series' --data-urlencode 'match[]={}' | python3 -m json.tool | grep -E '"(env|service)"' | sort -u`
2. Generate Testcontainers activity (run `pnpm test:e2e` in `apps/api`).

**Expected:** only `env=dev|prod` streams of the five app services appear;
no `neo-bank-monitoring-*` containers (no self-ingestion) and no
Testcontainers containers in Loki.

## S9 — Stopping monitoring leaves the application stack intact

1. `pnpm docker:monitoring:down`
2. `curl -fsS http://localhost:3001/health` → 200; the dev stack keeps
   serving; `docker ps` still lists all five dev containers.

**Expected:** monitoring down has zero application effect.

## S10 — Retention window

1. `curl -fsS 'http://127.0.0.1:3100/loki/api/v1/limits' | python3 -m json.tool | grep -i retention`

**Expected:** `retention_period: 168h` (7 days). Verifying actual deletion
requires an out-of-window query against aged data — impractical in a fresh
environment; rely on the compactor metrics (`loki_compactor_*`) over time.

---

## Verification log

- **2026-11-11 (implementation session, Docker Desktop / Docker Engine
  29.6.1):**
  - S1 partial **pass**: dev + monitoring stacks started; all containers
    healthy; `/health` 200; enrollments challenge 201 (requestId
    `31fa464a-e115-4860-b508-541f0f03f295` observed in the response); the
    API container produced structured pino JSON (S2 container side **pass**).
  - S2 host-side pretty behavior: covered by unit tests
    (`log.config.spec.ts`), not re-run manually.
  - S3–S10 **not yet executed**: the Docker Desktop daemon wedged mid-session
    (500 on every API route, `_ping` included — an environment failure, not
    a configuration defect) before pipeline-end queries could run. Compose
    validation (`docker compose config -q`) passed for all three files
    before the failure; images pulled successfully
    (`grafana/loki:3.7.9`, `grafana/grafana:13.2.5`, `grafana/alloy:v1.21.0`).
  - Re-run S1–S10 after restarting Docker Desktop; record outcomes here.
