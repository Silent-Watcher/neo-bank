# 034 — Docker Compose Configuration Centralization (`docker/`)

## Original User Request

Master prompt: reorganize the root-level Docker configuration of the Turborepo
monorepo. Centralize all root-level Docker Compose files in a dedicated
`docker/` directory and their associated root-level env files in
`docker/env/`. Purely structural: existing Docker behavior, services, build
configs, networking, volumes, env vars, and workflows must remain unchanged.
Understand the project first; do not move Dockerfiles; update all affected
paths (compose path resolution, package scripts, git/docker ignore rules, all
documentation); validate with `docker compose config` without running
up/down/build/pull; no ADRs; no commit.

## Implementation

- **Moves** (`git mv` for tracked, `mv` for untracked; contents preserved):
  `compose.yml`, `compose.app.dev.yml`, `compose.app.prod.yml`,
  `compose.prod.all.yml`, `compose.monitoring.yml` → `docker/`;
  `.env.docker`, `.env.docker.dev`, `.env.docker.example`, `.env.docker.prod`,
  `.env.monitoring`, `.env.monitoring.example` → `docker/env/`. Dockerfiles
  and `apps/*/env/` untouched. `.env.docker` (unused by scripts since _028,
  kept per the prompt's target tree) moved too.
- **Path-resolution approach** — self-contained Compose files, no
  `--project-directory` workaround: with `-f docker/compose.yml` the project
  directory becomes `docker/`, so only paths resolving against the project
  directory were rewritten: build `context: .` → `..` (Dockerfile paths
  unchanged — they resolve against the context, which stays the repo root, so
  the root and per-Dockerfile `.dockerignore` behavior is preserved);
  `env_file` → `../apps/api/env/…`; dev bind mount `.:/repo` → `..:/repo`;
  monitoring mounts `./monitoring/…` → `../monitoring/…`. `include:` paths
  unchanged (all five files share `docker/`, so both plausible include
  resolution rules give identical results). Named volumes, images, ports,
  networks, healthchecks, anchors, project names untouched.
- **Scripts** (`package.json`, 11 `docker:*` lines): `--env-file` →
  `docker/env/…`, `-f` → `docker/…`; `docker:dev`/`docker:dev:down` gained an
  explicit `-f docker/compose.yml` (root CWD auto-discovery would no longer
  find the moved base file). Names, flag order, and behavior preserved.
- **Ignore rules**: `.gitignore` unchanged (slashless patterns still ignore
  `docker/env/.env.*` at any depth and still negate the moved `*.example`
  files; verified with `git check-ignore -v`). Root `.dockerignore`: stale
  `compose.dev.yml`/`compose.prod.yml`/`compose.monitoring.yml` lines replaced
  with `docker/`. Per-Dockerfile ignores (`apps/*/Dockerfile.prod.dockerignore`)
  same replacement (`docker/` for the two dead names); their existing
  `**/.env.*` rules already kept `docker/env/` out of image contexts.
- **Comment/usage fixes** (behavioral lines untouched): compose file header
  usage commands; `:?` error messages now name `docker/env/…`;
  `.env.docker.example`/`.env.monitoring.example` usage comments; local
  `.env.docker.prod`/`.env.monitoring` comment headers (comments only, no
  values touched); stale `compose.dev.yml`/`compose.prod.yml` name mentions in
  `apps/*/Dockerfile.dev` comments, `apps/api/env/.env.test` comment, and the
  two orchestrator headers (which also had pre-_032 stale names).
- **Documentation**: `docs/docker.md` (file table with new paths + location
  note, env-files section, all commands), `docs/observability/README.md`,
  `docs/observability/manual-testing.md`, `docs/architecture.md`,
  `docs/current-state.md`, `PROJECT_CONTEXT.md` (Infrastructure bullet),
  `apps/api/ONBOARDING.md` (prereq paths). Deliberately NOT rewritten:
  `prompts/*`, `DECISIONS.md` ADR file inventories, `docs/judge-findings.md`
  (historical records, allowed to keep old paths).

## Process Notes

- No ADR: structural refactor with preserved behavior, explicitly out of scope
  per the master prompt ("Do not create unnecessary ADRs").
- ZCode multi-agent subagents (`project-explorer`, `code-reviewer`,
  `code-security-analyzer`) are not installed for this platform; exploration
  and review roles were performed by the primary agent, and validation was
  delegated to a general-purpose subagent whose report is the basis of the
  results below (AGENTS.md fallback rule).
- Validation needed two temporary gitignored placeholder files
  (`apps/api/env/.env.development`, `.env.production`) because `docker compose
  config` requires `env_file` targets to exist; both were deleted afterwards
  and `apps/api/env/` verified back to its exact prior state. The user's real
  env files were never read or printed; only comment lines of local env files
  were edited, via line-addressed sed.

## Validation (subagent report, Docker Compose v5.3.0)

- `docker compose config --quiet` PASS for: dev orchestrator (`docker/compose.yml`
  - both env files), dev app stack, monitoring stack, and — with
    `REDIS_PASSWORD`/`POSTGRES_PASSWORD` shell overrides — prod app stack and
    prod orchestrator. Without overrides prod correctly fails fast on the empty
    passwords in `docker/env/.env.docker.prod` (documented _028 fail-fast-by-
    design posture; the error naming `docker/env/.env.docker.prod` also proves
    the env file resolves from its new location).
- Resolved-config inspection: build contexts resolve to the repo root with the
  correct `apps/*/Dockerfile.{dev,prod}`; `env_file` resolves under
  `apps/api/env/`; dev bind mounts source the repo root to `/repo`; monitoring
  mounts resolve to `monitoring/{loki,grafana,alloy}` configs; project names
  `neo-bank-dev`/`neo-bank-prod`/`neo-bank-monitoring` intact; prod network
  isolation (postgres/redis on internal only, no host ports) and
  `DOCKER_GID`/Grafana interpolation verified.
- All 11 `docker:*` script paths exist; `git check-ignore` confirms real env
  files ignored and examples trackable; `git ls-files docker/` shows exactly
  the 7 tracked files; `git diff --check` clean; final stale-reference sweeps
  (compose names incl. dead `compose.dev.yml`/`compose.prod.yml`, env file
  names) return zero hits outside the historical records listed above.

## Notes

- No commit created (awaiting explicit user approval). Unrelated untracked
  `.agents/skills/ponytail/` from a previous task remains uncommitted.
- The host's Docker daemon was not needed (`config` is client-side); no
  containers, volumes, or running services were touched.
