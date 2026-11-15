# _044 — pgAdmin 4 Development-Only Docker Integration (ADR-028)

## Original Request

The user provided a master prompt: integrate pgAdmin 4 into the development
Docker Compose environment only — attach to the existing PostgreSQL service,
use the existing Docker network, auto-register the server, persist
configuration across restarts, follow the project's environment-variable
conventions, stay completely absent from production, never create a second
PostgreSQL instance, and pin an exact non-`latest` image version. The prompt
mandated a two-phase workflow: inspect and propose, stop for explicit
approval, then implement and validate.

## Phase 1 (inspection and proposal)

- `project-explorer` session baseline; inspected all Compose files, env
  files, healthchecks, port bindings, and ADR-024 as the dev-only-service
  precedent.
- Verified against official sources: latest stable pgAdmin 4 is **9.19**
  (release notes; Docker Hub tags `9.19`/`9.19.0`/`latest`/`2026-10-27-2`
  share digest `sha256:3591b3d02910dcd817dec6fcaa681c278ba6966945283dd0ea0042731c330c83`);
  container docs — default port 80, `servers.json` at `/pgadmin4/servers.json`,
  `PGADMIN_SERVER_JSON_FILE` override, persistent data at `/var/lib/pgadmin`,
  `PGADMIN_DEFAULT_EMAIL`/`PGADMIN_DEFAULT_PASSWORD`; **no native `${VAR}`
  substitution in `servers.json`** (upstream pgadmin-org/pgadmin4#8663);
  `PGADMIN_CONFIG_MASTER_PASSWORD_REQUIRED=False` suppresses the
  master-password prompt.
- Proposal presented: service `pgadmin` in `docker/compose.app.dev.yml` only,
  loopback port 5050, `pgadmin_data` volume, `depends_on.postgres.condition:
  service_healthy` reusing the existing `pg_isready` healthcheck, and two
  registration options (A: rendered `servers.json` via a minimal Python
  render step; B: registration only with a one-time password prompt).
- User approved: Option A, default port 5050, generated credentials, and
  teardown keyed on whether postgres was already up (it was not).

## Phase 2 (implementation)

- ADR-028 written to `DECISIONS.md` as the first repository write (Accepted,
  2026-11-15).
- `docker/pgadmin/servers.json.template` — pure-JSON server definition
  ("Neo Bank Development PostgreSQL", group "Development", host `postgres`,
  port 5432, maintenance DB/user/password via `${POSTGRES_*}` placeholders).
  An earlier draft used `//` comments, which are invalid JSON — caught before
  deployment and replaced by a `Comment` field.
- `docker/pgadmin/render_servers.py` — entrypoint render step: fails fast on
  missing environment variables (explicit `SystemExit`), substitutes `${VAR}`
  values JSON-escaped (`json.dumps(...)[1:-1]`), validates the output, writes
  to `PGADMIN_SERVER_JSON_FILE` (default `/tmp/servers.json`).
- `docker/compose.app.dev.yml` — `pgadmin` service: `dpage/pgadmin4:9.19`,
  entrypoint
  `['/bin/sh', '-c', 'python3 /pgadmin4/render_servers.py && exec /entrypoint.sh "$@"', '--']`,
  required `PGADMIN_DEFAULT_EMAIL`/`PGADMIN_DEFAULT_PASSWORD` (`:?`),
  `PGADMIN_CONFIG_MASTER_PASSWORD_REQUIRED: 'False'`,
  `PGADMIN_SERVER_JSON_FILE: /tmp/servers.json`, `POSTGRES_*` passthrough for
  the render (same interpolation source as the `postgres` service), read-only
  mounts of template and script, named volume `pgadmin_data:/var/lib/pgadmin`,
  `127.0.0.1:${PGADMIN_PORT:-5050}:80`, `depends_on.postgres.condition:
  service_healthy`, shared `x-logging` anchor; `pgadmin_data` added to
  top-level volumes.
- `docker/env/.env.docker.example` — `PGADMIN_PORT=5050` plus required empty
  `PGADMIN_DEFAULT_EMAIL`/`PGADMIN_DEFAULT_PASSWORD`, commented (ADR-028).
- `docker/env/.env.docker.dev` (gitignored) —
  `PGADMIN_DEFAULT_EMAIL=pgadmin@neo-bank.dev` plus a generated random
  password (`openssl rand -hex 24`, value never displayed); `PGADMIN_PORT`
  omitted like the other optional dev-service ports.
- Documentation: `docs/docker.md` (intro, Files/Ports tables, new pgAdmin
  section, Data Persistence bullet), `docs/current-state.md`
  (infrastructure paragraph, ADR-028 in the accepted list), `README.md`
  (Docker paragraph), `PROJECT_CONTEXT.md` (infrastructure bullet,
  DECISIONS index range) — written by the `documentation-writer` subagent and
  reviewed/corrected by the primary agent.

## Runtime findings and fixes

- First boot failed: `PermissionError` writing `/pgadmin4/servers.json` (the
  image runs as uid 5050) → render moved to `/tmp` with the documented
  `PGADMIN_SERVER_JSON_FILE` override.
- Second failure: pgAdmin's bundled email-validator rejects `.local` as a
  reserved special-use domain → dev email changed to `pgadmin@neo-bank.dev`.
- Third observation: the web server binds only after first-boot gunicorn
  initialization (~30–60 s) — no defect; login page then served HTTP 200.

## Validation results

- Static: `docker compose --env-file docker/env/.env.docker.dev -f
  docker/compose.app.dev.yml config` resolves image, entrypoint, loopback
  port, healthy-gated `depends_on`, volumes, and logging exactly as designed;
  production files validate unchanged (pgAdmin absent by construction; the
  prod orchestrator requires both env files as before).
- Runtime: startup ordering `postgres Healthy → pgadmin Started`; rendered
  file verified in-container (valid JSON, zero placeholders remaining,
  Username/Password/MaintenanceDB byte-equal to the postgres service
  environment, secrets masked in all output); pgAdmin log confirms
  "Added 1 Server Group(s) and 1 Server(s)"; config-DB row verified
  (`server`: name/host/port/username/maintenance_db); psycopg v3 connection
  from the pgadmin container with the registered credentials →
  `PostgreSQL 17.6` (`CONNECT_OK`); `--force-recreate` → registration row
  persists via `pgadmin_data` (first-launch import semantics), UI HTTP 200
  again afterwards.
- Not verified headlessly: interactive login and click-to-connect through the
  web UI (scripting Flask-Security's form flow did not complete; the
  container's startup validation of the initial credentials plus the direct
  psycopg connection evidence cover the underlying behaviors).
- Code review gate (Wave 6 in `docs/judge-findings.md`): CHANGES_REQUIRED
  with five accepted findings, all minor and applied (JSON escaping of
  substituted credentials, prompt-record creation, volume/password wording
  correction in ADR + compose comment, output-path single source of truth,
  dev-env comment wording); re-validated at runtime afterwards.

## Constraints honored

- Dev-only isolation (production files untouched), loopback binding (SEC-03),
  version pinning with digest verification, no secrets in tracked files or
  reports, no new networks or dependencies, tests untouched (ADR-016/025),
  no commit created.
