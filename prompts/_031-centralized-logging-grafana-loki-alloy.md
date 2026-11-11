# _031 — Centralized Logging with Grafana Alloy, Loki, and Grafana

- **Date:** 2026-11-11
- **Branch:** `feature/metric`
- **ADR:** ADR-022 (Accepted)
- **Judge review:** Wave 3 in `docs/judge-findings.md` (10 findings — 2 High, 2 Medium, 6 Low; 9 resolved, 1 Won't Fix with justification)

## Original request

The user supplied a comprehensive master task: implement a beginner-friendly, self-hosted centralized logging environment (Grafana + Loki + Grafana Alloy) for the existing Docker-based monorepo **without replacing the existing application logger**, and produce a comprehensive Persian learning guide that teaches the ecosystem through the actual implementation. The stack was pre-authorized (ADR-first approval flow explicitly waived by the task); Prometheus/Tempo/OpenTelemetry/alerting were scoped as documented future phases, not installs.

## Implementation

### Infrastructure (new)

- `compose.monitoring.yml` — independent Compose stack (project `neo-bank-monitoring`, isolated network, no application dependency): version-pinned `grafana/loki:3.7.9`, `grafana/grafana:13.2.5`, `grafana/alloy:v1.21.0`. Loki/Grafana on host loopback only (3100/3002); Alloy has no host port; bounded json-file log rotation on all services (`x-logging` anchor).
- `monitoring/alloy/config.alloy` — collection pipeline: `discovery.docker` (only `neo-bank-dev`/`neo-bank-prod` running containers — no self-ingestion, no Testcontainers), `discovery.relabel` (labels `env`/`service`/`container` from container names with a `keep` guard), `loki.source.docker` (tails stdout/stderr, persisted positions), `loki.process` (pino JSON parse: `level` label + authoritative `time` timestamp), `loki.relabel` (pino numeric levels → names), `loki.write`.
- `monitoring/loki/loki.yml` — single binary, filesystem storage on named volume, TSDB/v13, 7-day retention with compactor + `delete_request_store`, telemetry disabled.
- `monitoring/grafana/provisioning/` — Loki data source (uid `loki`) + dashboard provider as code; `monitoring/grafana/dashboards/api-logs.json` — investigation dashboard (volume by level, all logs, API errors) with `env`/`service` variables.
- `.env.monitoring.example` — `GRAFANA_PORT`, `GRAFANA_ADMIN_USER/PASSWORD` (required), `DOCKER_GID` (socket group; Alloy runs non-root + supplemental group, `no-new-privileges`).

### Application logger (minimal compatibility change only)

- `apps/api/src/shared/config/env/schema/log.env.ts` + `log.config.ts`: optional `LOG_PRETTY` (`true`/`false`) overrides the pretty default; unset behavior unchanged. Dev Compose stack sets `LOG_PRETTY: 'false'` so the containerized API emits structured JSON for collection; host dev keeps pino-pretty. Tests in `log.env.spec.ts` / `log.config.spec.ts`; documented in `apps/api/env/.env.example` and `ONBOARDING.md`.

### Repository wiring

- `compose.dev.yml` / `compose.prod.yml`: log rotation anchors; `LOG_PRETTY: 'false'` on the dev `api` service.
- Root `package.json`: `docker:monitoring`, `docker:monitoring:down`, `docker:monitoring:logs`.
- `.gitignore` (`.env.monitoring.example` un-ignored), `.dockerignore` (compose.monitoring.yml + monitoring/ excluded from build contexts).

### Documentation

- `DECISIONS.md`: ADR-022.
- `docs/observability/README.md` (operations, security notes, honest limitations, roadmap), `manual-testing.md` (S1–S10 scenarios)
- `docs/docker.md` (monitoring section, ports, rotation, LOG_PRETTY note), `docs/architecture.md` (observability boundary, independence), `docs/current-state.md`, root `README.md`, `docs/judge-findings.md` (Wave 3).

## Validation

- `docker compose config -q` passes for monitoring, dev, and prod (prod via throwaway env file).
- All three monitoring images pulled successfully.
- Live partial pipeline check: dev + monitoring stacks up, all healthy; API emitted structured JSON in the container (`LOG_PRETTY` works); `/health` 200; enrollments challenge 201 with `requestId` observed.
- Delegated API checks: typecheck + lint pass (0 errors); two initial failures fixed (missing `CORS_ORIGIN` stub in the new production test; oxfmt parentheses).
- **Blocked by environment failure:** Docker Desktop daemon wedged mid-session (HTTP 500 on all API routes including `_ping`) — S3–S10 of `manual-testing.md` (level/request-ID queries via Loki API, outage/recovery, persistence, rotation-on-disk, scope checks) could not be executed; recorded honestly in the verification log. Re-run after restarting Docker Desktop.

## Decisions

- Separate Compose file/project over overlays/profiles (independence requirement).
- Docker-API collection over mounted log files (format-stable, container-dynamic).
- Alloy over Promtail (Promtail is in maintenance mode).
- Labels limited to `env`/`service`/`container`/`level`; request IDs stay in the body (cardinality rule).
- Judge Wave 3: applied `container` label (out-of-order safety), `keep` guard, loopback ports, `no-new-privileges`, telemetry off, documented variable-query form, panel semantic fixes; rejected a socket proxy (local-only stack; documented as production requirement) and Alloy project-name plumbing (fixed repo constants; documented failure mode).
