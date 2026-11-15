# _047 — Shared MikroORM BaseEntity, Actor Audit Context, and UTC-First Storage Policy

- **Date:** 2026-11-15
- **Status:** Implemented; code review APPROVED (Wave 15), security review SECURITY_APPROVED_WITH_INFORMATIONAL_FINDINGS; db-tier test execution pending Docker daemon
- **ADRs:** ADR-029 (Shared MikroORM BaseEntity with Actor Audit Context and Native Optimistic Locking), ADR-030 (UTC-First TIMESTAMPTZ Storage Policy) — both Accepted before any implementation write.

## Original request

The user supplied a master prompt (PHASE 1–7) requesting a shared MikroORM `BaseEntity` for the NestJS API:

- BIGINT primary key mapped to TypeScript `string` with positive-identifier semantics (`CHECK (id > 0)`) and PostgreSQL auto-increment/identity.
- `createdAt` (non-nullable, `onCreate`, immutable), `updatedAt` (nullable, `NULL` on insert, `onUpdate` on real updates), no triggers, no redundant mechanisms.
- `createdBy`/`updatedBy` via a centralized AsyncLocalStorage actor context: `NULL` = system; no foreign keys, no client-trusted actor IDs; concurrent-request isolation; background jobs without an actor work.
- `version` via MikroORM-native optimistic locking (initial 1, increment by exactly one, no manual logic), client-provided expected version supported through the native mechanism, conflicts mapped to HTTP 409 within the existing Problem Details architecture.
- `deletedAt` strictly schema-only (no soft-delete behavior).
- UTC-first policy: TIMESTAMPTZ (prefer 3) everywhere, `forceUtcTimezone` explicit, PostgreSQL containers pinned to UTC (verified with `SHOW TimeZone`), IANA-zone conversion at the presentation boundary, mandatory UTC architecture document + ADR.
- Adoption by all existing entities (there were none — greenfield), migration impact assessment, tiered tests (schema, lifecycle, locking, CLS/audit, UTC), strict out-of-scope boundaries, and the Phase 7 stop-for-approval workflow.

## Investigation highlights (Phase 1–2, verified against installed sources)

- Installed: `@mikro-orm/core|postgresql|migrations|decorators` 7.2.9, `@mikro-orm/nestjs` 7.1.0.
- `@MappedSuperclass` does not exist in v7; the verified equivalent is `@Entity({ abstract: true })` (inlined during discovery — `metadata/types.d.ts:84-85`).
- `BigIntType` mode sync from the declared TS type exists (`MetadataDiscovery.js:2125-2128`), but explicit `type: 'bigint'` (string form) leaves the runtime hydration mode at JS `bigint` for non-PK paths because `ReflectMetadataProvider` skips `runtimeType` inference when an explicit type is set and oxc emits no `design:type` for initialized fields — the docs-recommended explicit `new BigIntType('string')` is used instead.
- Single numeric PKs default `autoincrement: true` → `bigserial` (`MetadataDiscovery.js:1792-1798`, `BasePostgreSqlPlatform.js:90-96`); identity columns are reachable only via the `generated` column-metadata hack — `bigserial` chosen (approved decision D1).
- `onCreate`/`onUpdate` run exactly on CREATE / real-UPDATE changesets (`ChangeSetComputer.js:45-52, 63-83, 89-107`); no-op updates skip `onUpdate`.
- `version: true` → `meta.versionProperty`, DDL default `1`, atomic `version = version + 1` in the UPDATE SQL with the old version in the WHERE clause, `OptimisticLockError` on row-count mismatch (`MetadataDiscovery.js:1910-1928, 1991-1995`; `AbstractSqlDriver.js:1166-1176`; `ChangeSetPersister.js:235-249, 327-331`).
- Client-provided expected version: `em.lock(entity, LockMode.OPTIMISTIC, { lockVersion })` (`EntityManager.d.ts:344`, `IDatabaseDriver.d.ts:388-393`, `UnitOfWork.js:993-1008`).
- `defineBaseEntityProperties` propagates base `checks`/`indexes`/`uniques` to concrete entities (`MetadataDiscovery.js:1164-1173`); `check` inside `@PrimaryKey()` is not processed — the PK check uses the class-level `@Check` decorator.
- Default `Date` column is `timestamptz` (precision 6); `TIMESTAMPTZ(3)` needs an explicit `columnType` (`BasePostgreSqlPlatform.js:74-81`).
- `forceUtcTimezone` (default `true`) affects timezone-less columns only; sets `platform.timezone = 'Z'` (`Configuration.d.ts:591-599`, `Platform.js:645-651`). The pg driver returns timestamp OIDs as raw strings (`typeOverrides.js`) and the driver issues no session `SET TIME ZONE` — the server `TimeZone` is the lever.
- No entities, migrations, tables, CLS, or auth existed — greenfield; nothing to migrate; the first feature entity's migration carries the base columns.

## Implementation

Decision points approved by the user ("approved" without amendments): D1 `bigserial` PK; D2 property `onCreate`/`onUpdate` callbacks for audit (no subscriber); D3 hardcoded `TZ: UTC` on the postgres services (no new env variable); D4 shared `mapOptimisticLockError` helper.

| File                                                                          | Change                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DECISIONS.md`                                                                | ADR-029 + ADR-030 accepted (first repository write)                                                                                                                                                                  |
| `apps/api/src/shared/database/base.entity.ts`                                 | new — shared abstract BaseEntity (id, createdAt, updatedAt, createdBy, updatedBy, version, deletedAt; propagated `@Check`)                                                                                           |
| `apps/api/src/shared/actor-context/actor-context.ts`                          | new — AsyncLocalStorage store (`runWithActorContext`, `getActorContext`, `getActorId`)                                                                                                                               |
| `apps/api/src/shared/actor-context/actor-context.middleware.ts`               | new — per-request context middleware; actor seam returns `null` until auth                                                                                                                                           |
| `apps/api/src/shared/database/mikro-orm.options.ts`                           | `forceUtcTimezone: true` added explicitly                                                                                                                                                                            |
| `apps/api/src/shared/errors/error.code.ts`                                    | `ErrorCode.VersionConflict` + problem-type/title/i18n-key maps                                                                                                                                                       |
| `apps/api/src/shared/errors/optimistic-lock.mapper.ts`                        | new — lock error → `AppHttpException(VersionConflict, 409)`, rethrows others                                                                                                                                         |
| `apps/api/src/shared/datetime/utc-datetime.ts`                                | new — `calendarDayUtcRange(localDate, timeZone)` via Intl offsets, DST-correct                                                                                                                                       |
| `apps/api/src/modules/app/app.module.ts`                                      | `NestModule.configure` registers `ActorContextMiddleware` for all routes                                                                                                                                             |
| `apps/api/src/i18n/en/errors.json`, `fa/errors.json`                          | `titles.versionConflict`, `details.versionConflict` (en + fa)                                                                                                                                                        |
| `docker/compose.app.dev.yml`, `docker/compose.app.prod.yml`                   | postgres `TZ: UTC` pin (ADR-030)                                                                                                                                                                                     |
| `apps/api/test/testcontainers.ts`                                             | TestPostgres container `TZ: 'UTC'`                                                                                                                                                                                   |
| `apps/api/test/fixtures/test-article.entity.ts`, `test-article.controller.ts` | test-only fixture entity + HTTP probe (create/find/update with expectedVersion and a test-only actor simulation)                                                                                                     |
| `apps/api/test/base-entity.db-spec.ts`                                        | new — 9 integration tests (schema shape, UTC, lifecycle, attribution, locking, concurrent race)                                                                                                                      |
| unit specs                                                                    | `base.entity.spec.ts` (5), `actor-context.spec.ts` (5), `actor-context.middleware.spec.ts` (2), `optimistic-lock.mapper.spec.ts` (2), `utc-datetime.spec.ts` (6)                                                     |
| docs                                                                          | `docs/utc-datetime.md` (new, mandatory UTC document), `apps/api/AGENTS.md` (Database Rules + Constraints ADR range), `apps/api/ONBOARDING.md`, `docs/current-state.md`, `docs/architecture.md`, `PROJECT_CONTEXT.md` |

## Key implementation decisions (recorded for the AI decision log)

1. **Explicit `new BigIntType('string')` instead of `type: 'bigint'`:** discovered through test failure — `ReflectMetadataProvider` skips `runtimeType` inference when an explicit type is set, and the vitest transformer (oxc via Vite 8) emits no `design:type` for initialized fields, so string-form `type: 'bigint'` left hydration mode at JS `bigint`. The docs' explicit-instance pattern is deterministic across tsc/swc/oxc.
2. **`Opt<T>` wrappers:** `em.create()` required `createdAt`/`version` input data without them; `Opt<T> | null` form keeps `em.create` inputs minimal while preserving `Date | null` reads (`Opt` is not distributive over unions, so `Opt<Date> | null` rather than `Opt<Date | null>`).
3. **v7 API renames:** `@mikro-orm/postgresql` exports `PostgreSqlEntityManager as EntityManager`; the NestJS EM token is core `EntityManager` (`createEntityManagerProvider` default); raw SQL goes through `em.getConnection().execute()`; schema generator is `orm.schema` (`create()` not `createSchema()`); `connect: false` option no longer exists (v7 init never connects).
4. **Probe controller wraps both `em.lock` and `flush()` in the mapped boundary** — the flush's versioned UPDATE also raises `OptimisticLockError` under concurrent races (proven by the concurrent test); this is the documented production pattern.
5. **Throttler storage swap in db-spec:** probe routes are globally throttled; the official in-memory `ThrottlerStorageService` replaces `ThrottlerStorage` in db-specs (no Redis in that tier).

## Validation

- `pnpm test` (unit): **43 files / 364 tests, all passed** — includes the 23 new tests (16 original + 3 DST-midnight/semantic-rejection tests from CR-02/CR-01 remediation + the canonicalization change) and the existing catalog-consistency suite.
- `pnpm typecheck`: clean. `pnpm build` (swc): clean — compiled output verified to emit decorators + `design:type` metadata and constructor initializers.
- `pnpm lint`: 0 errors; 58 warnings, all pre-existing (none in new/changed files).
- `pnpm format` / `format:check`: clean.
- `pnpm test:db` / `pnpm test:e2e`: **NOT executed** — the host Docker daemon was down at validation time (`docker info` failed; not retried per the retry-loop-prevention rule). The db-spec (9 tests) is written and ready; results pending.
- No migration generated (no tables existed); no environment variables added; no new dependencies.
- Review gates (multi-agent workflow, `docs/judge-findings.md` Wave 15): context-blind code review found CR-01/CR-02/CR-03 (1 Medium + 2 Low) — all fixed and re-reviewed **APPROVED**; security review found SEC-01 (Low, CWE-770 — fixed: canonicalized formatter cache) and SEC-02/03/04 (Informational — deferred with recorded requirements for the authentication task and first entity-backed routes) — re-reviewed **SECURITY_APPROVED_WITH_INFORMATIONAL_FINDINGS**.

## Remaining limitations

- db-tier and e2e execution pending Docker; unit tier proves metadata/ALSD/mapper/datetime behavior.
- `createdBy`/`updatedBy` are always `NULL` (system) until authentication lands; the middleware seam is the single place to fill.
- No production entity exists yet — `discovery.warnWhenNotEntities` override stays until the first one lands; the BaseEntity convention is enforced by documentation and review until then.
- No-op updates skip `updatedAt`/`updatedBy` (verified ORM behavior, accepted in ADR-029).
