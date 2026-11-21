# _059 — PostgreSQL 18.7 Upgrade for Native UUIDv7 (Enrollment Master Prompt Phase 1)

## Original Request

Phase 1 of the Enrollment master prompt: upgrade PostgreSQL so UUIDv7 is
generated natively by the database (required for the Enrollment `publicId` in
Phase 2). Inspect current versions, verify official supported releases,
create a dedicated ADR before touching infrastructure, update every version
reference consistently, validate the upgrade against a real PostgreSQL, and
verify `uuidv7()`/`uuid_extract_version()`, the existing MikroORM connection,
health checks, migrations, and the DB integration tests. No destructive
volume operations without approval; existing migrations immutable.

## Approval Gate

The ADR-040 proposal (PostgreSQL 17.6 → 18.7-alpine, dump/restore over
`pg_upgrade`, volume-safety strategy, full verification plan) was presented
via a structured question and the developer selected "Approve as proposed".
ADR-040 was then written to `DECISIONS.md` as **Accepted** — the first
repository write of the phase. The `postgres:18.7-alpine` image pull failed
with the environment's known Docker Hub 403 (registry/CDN); per the
retry-loop rule the pull was not retried, and the developer pulled the image
manually ("i pulled the requested docker image") before the upgrade resumed.

## Implementation

- **ADR-040** (`DECISIONS.md`, Accepted, 2026-11-22): target
  `postgres:18.7-alpine` in dev Compose, prod Compose, and Testcontainers;
  database-native `uuidv7()` defaults for `publicId`; controlled
  `pg_dumpall` → fresh cluster → restore upgrade mechanism; persistent-volume
  safety rules; backup/recovery posture; documentation sync; verification
  plan.
- **Image pins:** `postgres:17.6-alpine` → `postgres:18.7-alpine` in
  `docker/compose.app.dev.yml`, `docker/compose.app.prod.yml`, and
  `apps/api/test/testcontainers.ts` (default image + docstring).
- **Volume mount points (ADR-040 amendment, implementation-discovered):**
  PostgreSQL 18+ official images store data in major-version subdirectories
  under `/var/lib/postgresql` (docker-library/postgres#1259) and refuse to
  start with a mount at the legacy `/var/lib/postgresql/data` — the dev and
  prod Compose mounts moved to `/var/lib/postgresql` with a comment pointing
  at ADR-040; Decision 1 of the ADR amended accordingly (no alternative path
  exists; flagged to the developer in the phase report).
- **Dev data upgrade executed:**
  1. Snapshot on a temporary `postgres:17.6-alpine` container against the
     real volume: PG 17.6, tables `enrollments` (0 rows) +
     `mikro_orm_migrations` (1 row).
  2. `pg_dumpall | gzip` → `/home/ali/neo-bank-dev-pg17-dump-2026-11-22.sql.gz`
     (sha256 `72ef5171…`, perms 600, both `CREATE TABLE`s verified in the
     dump).
  3. `docker volume rename` does not exist in the Docker CLI — the old
     volume was preserved by a byte-verified `tar` copy into
     `neo-bank-dev_postgres_dev_data_pg17_archive` (1277 files, 48,321,376
     bytes, exact parity), the original volume removed, and a fresh volume
     created under the original Compose name.
  4. PG 18.7 booted on the fresh volume (after the mount-point fix);
     `DROP DATABASE neo_bank` cleared the auto-initialized database; the
     dump restored through `psql -d postgres` (only the anticipated
     `role "neo_bank" already exists` noise).
  5. Post-restore state matches the pre-upgrade snapshot exactly.
- **Documentation:** version references updated in `docs/docker.md` (2),
  `docs/current-state.md` (2), `apps/api/AGENTS.md` (1),
  `apps/api/ONBOARDING.md` (1), `PROJECT_CONTEXT.md` (1); final sweep found
  no remaining PostgreSQL 17 references outside historical records
  (`docs/judge-findings.md`, `prompts/_021/_040/_044`) and ADR-040's own
  context.

## Key Decisions

- **Dump/restore over `pg_upgrade`** (ADR-040 Decision 3): portable backup
  as a side effect, no old/new data-directory juggling, seconds of downtime
  at pre-launch scale.
- **Volume preservation via verified copy** (not rename — the CLI command
  does not exist): data preserved twice (archive volume + dump file) before
  anything was removed; recorded in `docs/ai-decisions.md` entry #33.
- **18+ image data-layout amendment** applied directly during
  implementation: the image refuses the legacy mount outright, so there was
  no alternative path to the approved outcome; ADR-040 Decision 1 amended
  and the deviation surfaced for developer veto.
- **No code-reviewer/security gate dispatch:** the changed scope is image
  pins, a Compose mount path, and documentation — no application logic
  changed (master prompt Phase 1 task 11 conditions reviews on the changed
  scope). Available on request.

## Validation (all executed, 2026-11-22)

- `SELECT version();` → PostgreSQL 18.7 (alpine, dev container).
- `SELECT uuid_extract_version(uuidv7());` → `7` (master prompt §6.4).
- Restore parity: `enrollments` 0 rows, `mikro_orm_migrations` 1 row, table
  list identical to the pre-upgrade snapshot.
- Dev stack up; API `/health` → 200 and `/health/ready` → 200 with
  `postgres: up`, `redis: up` (MikroORM connected to 18.7).
- `pnpm test:db`: 4 files, **28/28 passed** against the new Testcontainers
  pin (includes Toxiproxy black-hole fault-injection specs).
- Mimosa advisory on the Phase 0 commit was compat-mode noise (docs-only);
  no security claim made.

## Deferred

- **Prod volume swap:** the prod stack is not deployed; the same documented
  procedure (ADR-040 Operational Implications) applies when it is, with an
  explicit developer go-ahead against any live database.
- **Disposal of the PG 17 archive volume and dump file** awaits developer
  approval (ADR-040 volume-safety rule).
- Phase 2 (core data model with `publicId` default `uuidv7()`) awaits
  explicit developer instruction.
