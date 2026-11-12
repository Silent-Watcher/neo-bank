# 035 — MockServer Development-Time Infrastructure (ADR-024)

## Original User Request

Integrate MockServer as a development-only infrastructure service so resilience
patterns in the NestJS API can be tested and verified against simulated
downstream behavior. Requirements: discovery phase with a written proposal and
explicit approval before any change (ADR-first); MockServer exclusively in the
development Compose configuration; official `mockserver/mockserver` image with
an explicit stable version; no production leakage of any kind; MockServer
addresses shown in the API's existing development startup logs (host and
Docker-network contexts) without new logging mechanisms or mandatory
configuration; documentation with verified usage examples; an ADR in the
repository's established format; validation without launching long-running
services merely for convenience; nothing committed.

## Implementation

- **ADR-024** ("Use MockServer for Development-Time Resilience Testing")
  written to `DECISIONS.md` as the first repository write, after the proposal
  was approved. Documents context, decision, alternatives (WireMock, Toxiproxy,
  custom mock, manual simulation), consequences, and the development-only scope.
- **Compose** (`docker/compose.app.dev.yml`): new `mockserver` service —
  `mockserver/mockserver:9.2.0` (pinned; verified as the current stable release
  via Docker Hub tags and the GitHub release), port
  `127.0.0.1:${MOCKSERVER_PORT:-1080}:1080` (loopback-bound — see Decisions),
  shared `x-logging` anchor, no volumes (ephemeral expectations = clean state
  per restart), no healthcheck override (the distroless image ships a built-in
  `HEALTHCHECK` probing `PUT /mockserver/status`), and no `depends_on` from any
  service. The `api` service `environment:` gained `MOCKSERVER_HOST_URL:
  http://localhost:${MOCKSERVER_PORT:-1080}` and `MOCKSERVER_DOCKER_URL:
  http://mockserver:1080` (compose `environment` overrides `env_file`).
- **Interpolation env** (`docker/env/.env.docker.example`): `MOCKSERVER_PORT=1080`
  with a development-only comment.
- **Env files** (`apps/api/env/`): `MOCKSERVER_HOST_URL` / `MOCKSERVER_DOCKER_URL`
  documented-empty entries in `.env.example`, `.env.development`, `.env.production`
  (test files omit them, matching the existing `REDIS_INSIGHT_URL` convention).
- **Env schema**: the `REDIS_INSIGHT_URL` validation chain was extracted into a
  shared `optionalHttpUrlEnv(field)` helper in `validation-helpers.ts`
  (trim-blank→unset, http(s)-only, credential rejection) and reused for the two
  new optional fields in `server.env.ts` — behavior-preserving for
  `REDIS_INSIGHT_URL`.
- **Config & startup log**: `server.config.ts` maps both fields; `main.ts` builds
  a `mockserverUrls` object only when `APP_ENV=development` **and** at least one
  URL is set (double gate — stricter than the Redis Insight precedent, per the
  task's "development only" requirement); `startup-url.ts` renders a
  `MockServer:` section with `Host:`/`Docker:` lines between Swagger and Redis
  Insight, suppressing the section entirely when no address exists.
- **Tests**: `startup-url.spec.ts` — full-section rendering (exact output,
  section order), host-only/docker-only lines, section suppression for `null`
  and both-null addresses; `server.env.spec.ts` — `MOCKSERVER_HOST_URL` matrix
  mirroring `REDIS_INSIGHT_URL` (unset/empty/whitespace/http/https/trim/protocol
  /scheme/credentials) plus a username-only URL rejection case, and a focused
  `MOCKSERVER_DOCKER_URL` block including the compose-hostname URL form.
- **Documentation**: `docs/docker.md` (files table, ports table row, new
  "MockServer (development only)" section with run/stop commands, addresses,
  availability check, verified API examples, integration boundary),
  `docs/current-state.md`, `PROJECT_CONTEXT.md` (incl. fixing the stale
  "ADR-001…ADR-022" index line), `apps/api/ONBOARDING.md` (env table rows),
  `README.md` (stack enumeration sentence).
- **Findings tracker** (`docs/judge-findings.md`): Wave 5 (code review) and
  Wave 6 (security review) recorded with dispositions.

## Decisions

- **MockServer 9.2.0** over alternatives: current stable (2026-10-27), distroless
  non-root image, language-neutral REST control API, live dashboard, built-in
  chaos features; WireMock rejected (Java-centric distribution), Toxiproxy
  rejected for this purpose (network-level only, no HTTP response shaping),
  custom mock rejected (YAGNI). Documented in ADR-024.
- **Loopback port binding** (`127.0.0.1:` prefix): MockServer's control API is
  unauthenticated and can forward requests to arbitrary targets; binding to all
  interfaces would expose an SSRF-style pivot to network-adjacent peers.
  Containers reach it via the internal network, so nothing is lost. Matches the
  monitoring stack's loopback precedent (security review SEC-01).
- **Shared `optionalHttpUrlEnv` helper** instead of duplicating the
  `REDIS_INSIGHT_URL` chain three times (DRY).
- **Double gate** for the startup-log section (presence + `APP_ENV=Development`):
  satisfies the task's strict "development only" display requirement; the Redis
  Insight line is intentionally left presence-gated only (SEC-03 Won't Fix —
  out-of-scope behavior change to ADR-020 behavior).
- **No memory limit / no restart policy / no volumes**: matches the file's
  existing resource conventions; MockServer docs' 512 MiB recommendation noted
  in the proposal and declined for convention consistency.
- **Test env files** (`.env.test`, `.env.redis-test`) left untouched: they never
  carried `REDIS_INSIGHT_URL` either (established sync precedent).

## Validation (delegated subagent reports; Docker Compose v5.x)

- `docker compose config --services` renders: dev app stack and dev orchestrator
  both include `mockserver`; prod app stack and prod orchestrator contain no
  mockserver service and no mockserver reference in any prod source file.
  Rendered dev config confirms `host_ip: 127.0.0.1` for the mockserver mapping
  and the two `MOCKSERVER_*` values on the api service; prod renders show only
  empty-string `MOCKSERVER_*` entries (inlined `env_file` blanks, same
  mechanism as the pre-existing `REDIS_INSIGHT_URL: ""`), which the schema
  treats as unset.
- `pnpm format` (oxfmt): applied line-wrapping once, then neutral on re-run.
- `pnpm lint` (Oxlint): 0 errors, 42 warnings — identical set before and after
  (all pre-existing test-code style warnings; none in the changed files).
- `pnpm typecheck`: pass.
- `pnpm test` (unit suite): 285/285 passed (baseline 284 + 1 new case), including
  19 startup-url and 62 server-env tests.
- **Code review gate**: `APPROVED_WITH_SUGGESTIONS` (2 Low findings: both-null
  address pair rendering a bare header; untested username-only URL rejection) →
  both fixed → re-review `APPROVED`, no remaining findings.
- **Security review gate**: `SECURITY_CHANGES_REQUIRED` (1 actionable Low:
  all-interface port binding) → loopback binding applied → re-review
  `SECURITY_APPROVED_WITH_INFORMATIONAL_FINDINGS`; the two informational
  findings (SEC-02 C0/ANSI in pretty logs, SEC-03 Redis Insight gate symmetry)
  recorded as Won't Fix with technical justification.

## Notes

- Runtime behavior (starting the dev stack, live startup-log output, in-container
  DNS resolution of `mockserver`) was intentionally not exercised, per the task's
  instruction not to pull images or launch long-running services merely for
  convenience; compose rendering plus the unit suite cover the changed logic.
  The image tag and built-in healthcheck were verified against the official
  Docker Hub documentation and OpenAPI spec instead.
- MockServer has no consumer in the API yet (no outbound HTTP client exists);
  actual resilience test scenarios against it are a separate future task.
- An `.gitignore` line (`**/.mimosa`) added by the mimosa plugin's runtime state
  during the session was reverted once unintentionally and restored with a
  comment; unrelated to this feature.
- Not committed; awaiting explicit approval.
