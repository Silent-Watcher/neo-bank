# Observability Roadmap

Learning-and-implementation roadmap for the observability stack. Implemented
state and next stages; dependencies between stages; expected learning
outcomes per stage. The deep version of everything below — concepts, configs,
exercises — is the Persian handbook:
[`learning-guide.fa.md`](./learning-guide.fa.md) (chapters 14–16).

## Implemented (Stage 1 — Centralized Logging, ADR-022)

- **Services:** Grafana 13.2.5 (visualization, loopback :3002), Loki 3.7.9
  (storage, 7-day retention, loopback :3100), Grafana Alloy 1.21.0
  (collection via Docker socket).
- **Pipeline:** container stdout → Alloy (discovery → relabel → pino JSON
  parse → level normalization) → Loki → Grafana (provisioned data source +
  investigation dashboard).
- **Application integration:** existing Pino logger untouched; optional
  `LOG_PRETTY` env override keeps dev containers on JSON (ADR-022).
- **Skills delivered:** LogQL (selectors → parsers → metric queries), label
  cardinality modeling, Explore investigation workflows, 18 incident
  scenarios, 32 exercises.

## Stage 2 — Metrics (next)

- **Adds:** Prometheus + cAdvisor + Node Exporter; optionally a `/metrics`
  endpoint on the API (`prom-client`) — or defer app instrumentation to OTel
  (Stage 3) and keep one instrumentation system only.
- **Depends on:** Stage 1 (for log↔metric correlation workflows).
- **Learning outcomes:** RED/USE metrics, PromQL basics, histogram quantiles,
  container/host resource metrics; correlating metric spikes with logs
  (handbook ch. 14.1, 15.1).
- **Verify:** `up{job="api"} == 1`, request-rate/error-rate panels, cAdvisor
  dashboards.

## Stage 3 — Distributed Tracing

- **Adds:** OpenTelemetry SDK (auto-instrumentation) in the API + Grafana
  Tempo; telemetry path via Alloy's OTLP receiver (no separate OTel Collector
  unless tail sampling is genuinely needed).
- **Depends on:** Stage 2 preferred (metrics give the entry point), not
  strictly required.
- **Learning outcomes:** spans/trace context (W3C), TraceQL, trace-to-logs
  correlation; the flagship exercise: follow one request through HTTP →
  service → Redis in a single trace (handbook ch. 14.2–14.3, 15).
- **Verify:** service graph populated; traceId present in log lines.

## Stage 4 — Alerting

- **Adds:** Grafana Alerting rules (no new services); Alertmanager only if
  Prometheus-side rule management becomes preferable.
- **Depends on:** Stage 2 (numeric thresholds), except one log-based rule
  (error presence) that works already today — handbook exercise 29.
- **Learning outcomes:** evaluation/pending states, notification routing,
  grouping/silencing, alert-fatigue discipline (handbook ch. 14.4).
- **Verify:** a deliberately triggered alert passes Pending → Alerting and
  reaches a contact point.

## Stage 5 — SLI / SLO / Error Budgets

- **Adds:** recording rules + burn-rate dashboards on top of Stage 2 metrics.
  Example SLOs for this API: availability 99.5%; p95 latency < 500 ms.
- **Depends on:** Stage 2 (+ Stage 4 to alert on burn rate).
- **Learning outcomes:** SLI vs SLO vs SLA, error budgets, user-visible
  reliability vs infrastructure health (handbook ch. 16, Stage 5).

## Stage 6 — Continuous Profiling

- **Adds:** Grafana Pyroscope + Node.js profiler in the API (measure overhead
  in dev first).
- **Depends on:** Stage 2/3 — profiling answers "which function", which only
  pays off once metrics/traces say "something is slow".
- **Learning outcomes:** flame graphs, CPU/heap/allocation profiling,
  profile-to-trace correlation (handbook ch. 14.5).

## Stage 7 — Production Observability

- **Closes every row of the local-vs-production gap table (handbook ch.
  13.8):** Loki HA (multi-replica + ring store + object storage), TLS + SSO +
  RBAC on Grafana, restricted Docker-socket proxy or platform-native
  collection, automated backups, resource limits, self-monitoring of the
  monitoring stack, documented deploy/upgrade runbooks.
- **Depends on:** real deployment targets existing (not the case yet).

## Transition rules (apply to every stage)

1. One ADR per stage before implementation (repo rule).
2. New services: version-pinned, health-checked, no host ports unless needed,
   named volumes.
3. One instrumentation system per signal, ever.
4. Every stage ships with at least one hands-on exercise and a written
   verification step.
