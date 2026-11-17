# _051 — MikroORM Database Lifecycle, Enrollment Entity & Migration Governance

**Date:** 2026-11-16
**Status:** Implemented (pending commit approval)

## Original User Request

Master prompt (abridged): act as a senior NestJS/MikroORM/database engineer;
inspect the repository first and present a discovery report and implementation
plan for approval before any code change. Then:

1. **Database connection lifecycle logging** — investigate whether the
   installed MikroORM version exposes real connection lifecycle events (not
   entity hooks, not invented APIs); if yes, register listeners using the
   existing application logger, with duplicate-registration safety and full
   shutdown cleanup; if not, report the limitation and use only documented
   alternatives.
2. **BaseEntity primary key** — verify BIGINT at the database level, `string`
   in application code, full precision preserved; verify BaseEntity is a
   mapped superclass producing no table.
3. **Enrollment entity** — new `Enrollment` entity owned by the enrollment
   module, in an `entities/` directory, extending `BaseEntity` without
   redeclaring inherited fields; sole own property `phoneNumber` (column
   `phone_number`); table `enrollments`; no extra constraints, no relations.
4. **Strict entity registration** — `MikroOrmModule.forFeature([Enrollment])`
   only; no unrelated registrations.w
5. **Migrations** — generate through the existing MikroORM workflow; every
   column snake_case; verify `up()`/`down()`; no BaseEntity table, no foreign
   keys, no unrelated changes; never execute against uncontrolled databases.
6. **UTC-only date/time persistence** — permanent rule.
7. **Immutable migration policy** — permanent rule: existing migrations are
   never edited/deleted/renamed/squashed; corrections are new forward
   migrations; documented permanently in root `AGENTS.md`.
8. **Dedicated migration-reviewer sub-agent** — persistent, reusable,
   read-only reviewer for every new migration, with a structured report and
   APPROVED / CHANGES REQUIRED verdicts; corrections only as new forward
   migrations.
9. **Permanent agent rules** — update root `AGENTS.md` (entity organization,
   registration, UTC, immutability, snake_case inspection, BaseEntity rules,
   migration review).
10. Full verification and an honest final report; no commits unless asked.

## Implementation Record

### Discovery (Phase 1–2, presented and approved)

Key findings: MikroORM 7.2.9 on PostgreSQL (`@mikro-orm/postgresql`, pg Pool
under a Kysely dialect); BaseEntity already compliant (BIGINT `bigserial` PK →
`BigIntType('string')`, abstract mapped superclass, ADR-029 committed); no
connection lifecycle events in MikroORM — but the public documented
`PostgreSqlConnection.getNativeClient()` accessor exposes the pg Pool with its
vendor-documented EventEmitter events; default `UnderscoreNamingStrategy`
guarantees snake_case without configuration; migration workflow already
explicit-only (ADR-027). Two ADRs proposed (governance; lifecycle logging),
entity itself covered by ADR-027/029/030.

### ADRs (Phase 3, first repository writes after approval)

- **ADR-033 — Immutable Migration Policy and Dedicated Migration Reviewer**
  (Accepted). Migrations immutable forever; corrections only as new forward
  migrations; read-only `migration-reviewer` subagent added to the `.agents/`
  framework and made mandatory for every new/corrective migration; permanent
  rules documented in root `AGENTS.md` ("Database Entity and Migration
  Governance") and `apps/api/AGENTS.md`.
- **ADR-034 — Database Connection Lifecycle Logging via the pg Pool**
  (Accepted). Pool-level `'connect'` (info) + `'error'` (warn) listeners via
  the public `getNativeClient()` accessor; `'acquire'`/`'release'` skipped
  (per-query noise); Pino logger only; duplicate-safe registration; listeners
  removed in `beforeApplicationShutdown` (before `@mikro-orm/nestjs` closes the
  ORM in `onApplicationShutdown`); ORM keeps sole ownership of closing.
  Mechanism note: registration is sequenced by a constructor dependency edge
  on `DatabaseConnectionInitializer` (amended during implementation — see
  review finding CR-01 below; decision unchanged).

### Sub-agent framework

`.agents/definitions/migration-reviewer.md` (read-only: Read, Grep, Glob) +
`.agents/schemas/migration-review-report.md` template; `AGENT_PRESENTATION`
entry and plugin version bump (0.1.0 → 0.2.0) in `scripts/agents/sync.mjs`;
synced for ZCode + Claude Code; `.agents/README.md` and
`.agents/workflows/development-workflow.md` updated; root `AGENTS.md`
subagent list + orchestration rule added. Limitation recorded: the new agent
type cannot load into a session that started before the sync — this task's
review ran in an isolated general-purpose subagent executing the definition
verbatim; real delegation needs a plugin marketplace refresh + session
restart.

### Entity + registration

- `apps/api/src/modules/enrollments/entities/enrollment.entity.ts` —
  `@Entity({ tableName: 'enrollments' })`, extends `BaseEntity`, sole property
  `phoneNumber` (default string mapping → `phone_number`).
- `EnrollmentsModule` imports `MikroOrmModule.forFeature([Enrollment])`.
- `mikro-orm.options.ts`: dropped `discovery: { warnWhenNoEntities: false }`
  (its own comment authorized dropping it for the first feature entity) and
  updated the `CLI_ENTITY_PATHS` docstring.

### Connection lifecycle logging

`apps/api/src/shared/database/database.lifecycle.ts` (`DatabaseLifecycleLogger`,
wired in `DatabaseModule`): constructor-injects `DatabaseConnectionInitializer`
(DI edge sequencing the bootstrap hooks — same-level hooks run concurrently in
Nest 12), guards with `orm.isConnected()`, narrows with `instanceof
PostgreSqlConnection`, attaches stable pool listeners, removes them
idempotently in `beforeApplicationShutdown`.

### Migration (Phase 5–6)

- `pnpm db:migration:create` → `Migration20261116181139.ts` (+ `.snapshot-
  neo_bank.json`): single `CREATE TABLE "enrollments"` with the eight base
  columns + `phone_number varchar(255) not null` + `base_entity_id_positive`
  check; `down()` = `drop table if exists "enrollments" cascade`. Inspected
  line-by-line; snake_case verified; no FKs, no BaseEntity table.
- Applied to the dev Compose PostgreSQL (`db:migration:up`) after review;
  live schema verified with `\d enrollments`.
- `migration-reviewer` verdict: **APPROVED**, zero findings (column-by-column
  verification against entity metadata, snapshot consistency, discoverability).
- Formatting note: `oxfmt` rewrapped the two `addSql(...)` call sites after
  generation (whitespace only — SQL strings byte-identical, executed DDL
  unchanged; kept to keep lint-staged deterministic at commit time).

### Tests

- `enrollment.entity.spec.ts` — metadata-only unit spec (extends BaseEntity,
  table name, sole own property, snake_case column mapping, inherited columns
  inlined).
- `test/enrollment.db-spec.ts` — real-PostgreSQL tier through the real
  AppModule: table shape, PK/check/no-FK constraints, string-BIGINT id +
  UTC instant round-trip, and real-boot registration of the pool lifecycle
  listeners (ADR-034 proof).
- `database.lifecycle.spec.ts` — attach-once, log levels, skip paths (not
  connected / non-PostgreSQL connection), duplicate registration prevention,
  idempotent shutdown cleanup; `Logger.prototype` spy pattern.
- `base-entity.db-spec.ts` — override updated: explicit entity list
  (`BaseEntity`, `TestArticle`, `Enrollment`) + `autoLoadEntities: false`.

### Review gates

- `code-reviewer` iteration 1: **CHANGES_REQUIRED** — CR-01 BLOCKER (verified
  against installed Nest core sources): same-level `onApplicationBootstrap`
  hooks run concurrently, so the providers-array-ordering assumption was
  wrong and the `isConnected()` guard would have deterministically skipped
  registration on every cold start. Fixed via the constructor DI edge; two
  SUGGESTIONs (alias consistency; `Logger.prototype` spy pattern) also
  applied. Findings tracked in `docs/judge-findings.md` Wave 21.
- `code-security-analyzer`: (pending — runs after code-review approval)
- `migration-reviewer`: **APPROVED** (zero findings).

## Validation Results (actual)

| Check              | Result                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| `pnpm format`      | clean (181 files)                                                                                       |
| `pnpm lint`        | 0 errors (56 pre-existing warnings elsewhere; 0 in changed files)                                       |
| `pnpm typecheck`   | clean                                                                                                   |
| `pnpm test` (unit) | 45 files / 386 tests passed                                                                             |
| `pnpm test:db`     | 3 files / 21 tests passed                                                                               |
| `pnpm test:e2e`    | 16 files / 96 tests passed                                                                              |
| `pnpm test:redis`  | 4 files / 60 tests passed                                                                               |
| Migration review   | APPROVED, 0 findings                                                                                    |
| Code review        | iteration 1 CHANGES_REQUIRED → fixes applied → iteration 2 re-review in progress                        |
| GitNexus           | impact (DatabaseModule/EnrollmentsModule/buildMikroOrmOptions) LOW before edits; detect-changes pending |

## Key Gotcha Discovered (documented for future agents)

With `autoLoadEntities: true`, `@mikro-orm/nestjs` 7.1.0 copies `forFeature`
registrations into **`entitiesTs`** (`mikro-orm.providers.js`), and TS-mode
discovery (Vitest) uses `entitiesTs` **instead of** `entities`. Database-tier
overrides of `MIKRO_ORM_MODULE_OPTIONS` must set `autoLoadEntities: false`
and list entities explicitly (complete: fixture entities + `BaseEntity` +
every `forFeature`-registered entity in the booted tree — its repository
provider resolves eagerly). Documented in `apps/api/AGENTS.md` Database
Rules.

## Limitations / Notes

- `migration-reviewer` delegation requires a ZCode plugin marketplace
  refresh + session restart (see above); the definition, schema, sync, and
  workflow rules are in place and reusable.
- Pool `'error'` lines may duplicate the driver's internal (silent-by-default)
  log when debug logging is enabled — accepted in ADR-034.
- Boot-time physical connections are not observed (the initializer logs boot
  success explicitly) — accepted in ADR-034.
- Dev Compose PostgreSQL was started for migration work (pre-existing
  container `docker-postgres-1`, previously exited) — state restored by
  stopping it again after verification (zero-orphan rule).
- No commit created (not requested).
