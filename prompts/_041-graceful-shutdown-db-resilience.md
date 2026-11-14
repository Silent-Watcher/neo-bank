# _041 — Graceful Shutdown Audit & Database Connection Resilience

## Original Request

The user provided a structured task prompt: "Audit and Implement Graceful Shutdown & Database Connection Resilience" — continuing the MikroORM/PostgreSQL integration (_040). Phase 1 required a read-only audit (shutdown lifecycle, connection resilience, other resources) with an explicit stop for approval; after approval: ensure graceful shutdown, implement a minimal bounded retry for the **initial** PostgreSQL connection (max 5 attempts including the first, small exponential backoff, fail startup on exhaustion, no retry of permanent configuration/authentication errors), add two permanent engineering rules to the canonical project instructions, and verify concrete scenarios (A: DB available; B: DB starts late; C: DB stays unavailable; D: invalid credentials). Explicitly out of scope: retry for queries/writes/transactions, circuit breakers, bulkheads, Redis/HTTP resilience, unrelated refactoring.

## Audit Findings (Phase 1, reported before any change)

- `enableShutdownHooks()` present (`main.ts:100`); no manual `process.on` signal handlers anywhere (Nest owns SIGTERM/SIGINT).
- MikroORM connection closed by `@mikro-orm/nestjs` `onApplicationShutdown` — no duplicate manual cleanup.
- Redis: `RedisService` already implements bounded graceful QUIT + listener removal + state-guarded disconnect.
- The single recurring timer (memory-protection RSS sampler) is cleared on shutdown and `unref()`'d.
- No native retry mechanism exists in `@mikro-orm/core@7.2.9` or `@mikro-orm/nestjs@7.1.0` (TypeORM-style `retryAttempts`/`retryDelay` unsupported) — a small initializer is required.
- Gap vs the task's requirements: startup did not establish the DB connection at all (approved ADR-027 non-blocking semantics) → **ADR-027 amendment required and approved**: initial connection at bootstrap with bounded retry; startup fails on exhaustion; PostgreSQL explicitly exempted from the "no mandatory startup dependency" rule as architecture-required.

## Implementation Record

### ADR

- **ADR-027 Amendment 2026-11-14: Initial Connection at Startup** written into `DECISIONS.md` (first repository write of this task, after explicit approval): retry limits, permanent-error classification, fail-fast semantics, unchanged post-boot health contract, root-rule exception scoped to PostgreSQL.

### Files created

- `apps/api/src/shared/database/database.connect.ts` — `DatabaseConnectionInitializer` (`OnApplicationBootstrap`): `orm.connect()` per attempt (supported API, single ORM instance); **5 attempts incl. the first**, backoff 1s → 2s → 4s → 8s (capped), 5s per-attempt timeout (shared `withTimeout` helper); permanent SQLSTATEs (`28P01`, `28000`, `3D000`) fail immediately; exhaustion throws a meaningful error (Nest logs it, bootstrap fails, non-zero exit); retry backoff timers are `unref()`'d so a signal during the wait never blocks shutdown; retry limits are injectable (`DatabaseConnectOptions`, `@Optional`) for tests — no new env vars.
- `apps/api/src/shared/database/database.timeout.ts` — shared bounded-race helper (extracted from the health indicator's private `withTimeout`; DRY).
- `apps/api/src/shared/database/database.connect.spec.ts` — unit specs: first-attempt success, transient-then-success, retry exhaustion with exact message, permanent-auth no-retry, missing-database no-retry, per-attempt timeout (fake timers, fast injected limits).
- `prompts/_041` (this file).

### Files modified

- `database.module.ts` — initializer registered as a provider; module doc updated (boot-time connect semantics).
- `database.health.ts` — probe uses the shared `withTimeout`; probe timeout lowered to **3000 ms** (strictly below the Compose 5s healthcheck timeout, per judge CR-05); probe calls `connect()` unconditionally (judge CR-02: `isConnected()` would itself run a `select 1` — one query per probe now).
- `database.health.spec.ts` — timeout assertions 3000 ms; unconditional-connect expectations.
- `mikro-orm.options.ts` — new `buildRuntimeMikroOrmOptions(url)` (judge CR-06: single source for the runtime factory shape; used by the module and both test override helpers).
- `apps/api/test/database.db-spec.ts` — unreachable-PostgreSQL case now asserts **startup failure after bounded retries** (fast injected limits) instead of the old degraded-boot behavior.
- `apps/api/test/create-test-app.ts` — `createE2eTestApp` uses the shared runtime builder; new `stubDatabaseConnect` option (real-Redis tier never touches PostgreSQL — stubbed initializer keeps boots instant instead of burning the retry budget against the tier's validation-only `DATABASE_URL` placeholder).
- `apps/api/test/rate-limit.redis-spec.ts` — both full-AppModule call sites set `stubDatabaseConnect: true`.
- `apps/api/package.json` — `db:migration:*` scripts gained `pnpm build && ` (judge CR-03: the CLI resolves `#config/*` to compiled `dist/`; without a build the scripts crash on fresh clones or validate a stale schema).
- `docker/env/.env.docker.example` — `POSTGRES_PASSWORD` URL-safety constraint documented (judge CR-04; Compose cannot percent-encode interpolation values).
- Root `AGENTS.md` — two new permanent rule sections: **Resource Lifecycle and Graceful Shutdown** and **Database Connection Resilience** (canonical rule location; no new ADR per the task); "External Service Integrations" cross-references the PostgreSQL exception.
- `apps/api/env/.env.development` — `DATABASE_URL` password unquoted (judge CR-01: a mid-URL quoted password reached the app literally); the local dev postgres role re-aligned to the same unquoted value via `ALTER USER`.
- Docs: `docs/current-state.md`, `PROJECT_CONTEXT.md`, `apps/api/AGENTS.md`, `apps/api/ONBOARDING.md` — amended startup semantics; `docs/judge-findings.md` — Wave 13 (CR-01…CR-06, all resolved); `docs/ai-decisions.md` — new entries.

### Validation results (all executed)

- `pnpm typecheck` clean; `pnpm lint` 0 errors (warnings at/below the pre-existing baseline); `pnpm format:check` clean; `pnpm build` clean (71 files).
- Unit tests 38 files / **340 passing**; `test:redis` 4 files / **60 passing**; `test:db` 1 file / **4 passing** (incl. the new startup-failure scenario through the real AppModule); `test:e2e` 15 files / **83 passing**.
- **Scenario A** (DB available): real boot logs `PostgreSQL connection established.` on the first attempt; `/health` reports `postgres: up`; SIGTERM terminates cleanly.
- **Scenario B** (DB starts late): boot during outage logged 2 refused attempts, then `PostgreSQL connection established on attempt 3.` after Postgres started; `/health` `postgres: up`.
- **Scenario C** (DB stays unavailable): exactly 5 attempt failures, then `PostgreSQL connection failed after 5 attempts: connect ECONNREFUSED 127.0.0.1:5432`, exit code 1, HTTP server never started.
- **Scenario D** (invalid credentials): `28P01` password authentication failure — immediate termination, **0 retries**, exit code 1.

### Constraints honored

- No commits; no unrelated refactoring; no resilience patterns beyond connection establishment (no query/transaction retry, no circuit breakers, no pool tuning); Redis/HTTP/throttler/memory-protection untouched except the doc-level cross-reference; shutdown lifecycle changes limited to the initializer + DRY timeout helper.
