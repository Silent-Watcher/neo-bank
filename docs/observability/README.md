# Observability: Centralized Logging (Grafana + Loki + Alloy)

Operations guide for the monitoring stack defined in `compose.monitoring.yml`
(ADR-022). Reproducible verification scenarios:
[`manual-testing.md`](./manual-testing.md). Future stages: the observability
roadmap — [`roadmap.md`](./roadmap.md).

## Components

| Service | Image                    | Role                                                                                             | Host access                                     |
| ------- | ------------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| Alloy   | `grafana/alloy:v1.21.0`  | Collector: discovers containers via the Docker socket, relabels, parses pino JSON, ships to Loki | none (debug UI internal-only on `:12345`)       |
| Loki    | `grafana/loki:3.7.9`     | Log storage: single binary, filesystem storage on a named volume, 7-day retention                | `127.0.0.1:${LOKI_PORT:-3100}` (HTTP API/LogQL) |
| Grafana | `grafana/grafana:13.2.5` | Visualization: provisioned Loki data source + dashboard                                          | `127.0.0.1:${GRAFANA_PORT:-3002}` (UI)          |

All three run in the `neo-bank-monitoring` Compose project on an isolated
network. No application service joins it; applications have no runtime
dependency on monitoring.

## Setup

```sh
cp .env.monitoring.example .env.monitoring
# then edit .env.monitoring:
#   GRAFANA_ADMIN_PASSWORD  — required, no default
#   DOCKER_GID              — required: stat -c %g /var/run/docker.sock
```

`DOCKER_GID` is the group id that owns the Docker socket on the host. Alloy
runs as the image's non-root user plus this supplemental group so it can
read the socket without running as root.

## Commands

```sh
pnpm docker:monitoring          # start (docker compose ... up -d)
pnpm docker:monitoring:logs     # follow monitoring container logs
pnpm docker:monitoring:down     # stop (volumes are kept)
docker compose --env-file .env.monitoring -f compose.monitoring.yml ps
docker compose --env-file .env.monitoring -f compose.monitoring.yml restart alloy
```

Volumes (all named, all survive `down`; never run `down -v` on this stack):
`monitoring_loki_data` (Loki index+chunks+compactor), `monitoring_grafana_data`
(dashboards/users created in the UI), `monitoring_alloy_data` (positions file
that prevents re-ingestion after restarts).

## First use

1. Start any application stack (e.g. `pnpm docker:dev`) and the monitoring
   stack.
2. Open <http://localhost:3002> and sign in with `GRAFANA_ADMIN_USER` /
   `GRAFANA_ADMIN_PASSWORD` from `.env.monitoring`.
3. The `Neo Bank API Logs` dashboard (folder "Neo Bank") is provisioned
   automatically; the Loki data source is preconfigured (uid `loki`).
4. Generate traffic (`curl http://localhost:3001/health`, the enrollments
   endpoints) and watch the dashboard and Explore.

## Data flow

```
container stdout/stderr (Docker json-file driver, rotated 10 MB x 3)
  -> Docker daemon API (unix socket, read-only mount)
  -> Alloy: discovery (dev/prod projects only) -> relabel (env, service,
     container) -> parse pino JSON (level label, app timestamp)
  -> push http://loki:3100/loki/api/v1/push
  -> Loki: TSDB index + chunks on a named volume, 7-day retention
  -> Grafana queries Loki (Explore, dashboards)
```

Labels (low cardinality by design): `env` (`dev`|`prod`), `service`
(`api`|`web`|`admin`|`postgres`|`redis`), `container` (service-index),
`level` (`trace`..`fatal`, pino-parsed services only). Request IDs and all
other per-request values live in the log body only — never as labels.

## Troubleshooting

| Symptom                          | Check                                                                                                                                                                                                                                           |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard shows "No data"        | `docker compose --env-file .env.monitoring -f compose.monitoring.yml ps`; is Alloy up? Is the app stack running under its standard project name (`neo-bank-dev`/`neo-bank-prod` — Alloy discovers exactly these)?                               |
| Alloy not collecting a container | Alloy debug UI (internal): `docker compose --env-file .env.monitoring -f compose.monitoring.yml exec alloy wget -qO- http://127.0.0.1:12345/metrics \| grep loki_source_docker` — or check `docker logs neo-bank-monitoring-alloy-1`            |
| Loki unreachable                 | Loki has no in-container healthcheck (distroless image): verify from the host with `curl -fsS http://127.0.0.1:3100/ready`; check `docker logs neo-bank-monitoring-loki-1`                                                                      |
| Logs stop after Loki downtime    | They resume: Alloy keeps tailing and retries pushes. Verify with `curl -fsS 'http://127.0.0.1:3100/loki/api/v1/labels'` after recovery                                                                                                          |
| Grafana login rejected           | `GRAFANA_ADMIN_USER`/`PASSWORD` changed in `.env.monitoring` but Grafana volume already holds the old admin user — the env credentials only seed the first start; reset via Grafana CLI or recreate the volume (destroys UI-created dashboards) |
| Duplicate-looking entries        | Loki rejects exact duplicates (same stream + timestamp + line); apparent repeats are usually genuinely repeated log emissions (e.g. nest restart) — compare `time` and `reqId` in the JSON body                                                 |

## Security notes (local environment)

- The Docker socket mount gives Alloy full Docker API access — the mount is
  read-only, but **that does not make the API read-only**. Keep the stack on
  a personal machine; a shared/production host must front the socket with a
  restricted read-only-API proxy or use platform-native collection.
- Grafana and Loki are bound to `127.0.0.1` only. Alloy has no host port.
- No telemetry egress: Loki `analytics.report_enabled: false`, Grafana
  usage reporting and update checks disabled.
- Admin credentials live in `.env.monitoring` (gitignored). A deployment
  beyond a laptop should use file-based secrets
  (`GF_SECURITY_ADMIN_PASSWORD__FILE`) and TLS in front of Grafana.
- The API's log redaction (authorization/cookie headers) happens in the
  application logger before anything reaches the pipeline; the pipeline adds
  no redaction. Do not log new sensitive fields without extending the
  logger's `redact` paths.

## What this is not (honest limitations)

- Single-node, single-replica, local-disk storage: **no high availability,
  no disaster recovery**. A volume loss is a data loss; back up
  `monitoring_loki_data` if these logs matter.
- 7-day retention is a learning default (`limits_config.retention_period`),
  not a compliance setting.
- Plain-text services (PostgreSQL, Redis, frontends) get `env`/`service`/
  `container` labels but no `level` label — level filtering applies to the
  API's structured JSON.
- Production-grade deployment additionally needs: socket proxying, TLS +
  real auth in front of Grafana, Loki object storage (S3/GCS) or replicated
  volumes, resource limits, alerting, and backup automation.

## Roadmap (not installed)

1. **Metrics:** Prometheus + the API's own metrics endpoint; cAdvisor and
   Node Exporter for container/host metrics.
2. **Tracing:** OpenTelemetry SDK in the API + Grafana Tempo; correlates
   traces with logs via trace IDs.
3. **Alerting:** Grafana Alerting (unified) against Loki/Prometheus queries
   → notification channels.
4. **Production collection:** replace the Docker-socket dependency per the
   security notes above.
