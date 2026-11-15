# AI Decision Log

Record of decisions made by AI agents **independently** — without explicit
developer direction and not already established by project documentation,
conventions, or an accepted ADR. The purpose is to keep such decisions visible
and reviewable instead of letting them silently become permanent parts of the
architecture.

## What belongs here

- Meaningful choices the agent made on its own: testing strategies, dependency
  introductions, boundary or behavior changes, interpretation of underspecified
  requirements.
- Decisions that follow from an approved proposal but whose concrete shape was
  left to the agent (defaults, file placement, internal structure) are recorded
  when the concrete choice was the agent's.

## What does not belong here

- Trivial implementation details (variable names, formatting, following an
  existing convention).
- Choices the developer requested explicitly.
- Architecture decisions with accepted ADRs — reference the ADR instead of
  duplicating it.

## Boundaries with other documentation

| Document                           | Records                                                           |
| ---------------------------------- | ----------------------------------------------------------------- |
| `DECISIONS.md`                     | Approved architecture decision records (ADRs)                     |
| `docs/ai-decisions.md` (this file) | Independent agent decisions, with ADR candidates flagged          |
| `docs/judge-findings.md`           | Findings from the independent AI code/security judges             |
| `DEFERRED.md`                      | Explicitly deferred work and technical debt                       |
| `prompts/_NNN-*.md`                | Per-feature records: original request, implementation, validation |

## Entry format

Each entry carries the fields below. The **Task** reference links the decision
back to the prompt record of the task it originated from.

- **Task:** `_NNN-slug.md`
- **Date:** `YYYY-MM-DD`
- **Context:** What problem or situation required a decision?
- **Decision:** What did the agent decide?
- **Reasoning:** Why was this approach selected?
- **Alternatives:** What other reasonable options were considered?
- **Trade-offs:** Advantages and disadvantages.
- **Impact:** Which parts of the project are affected?
- **Reversibility:** How difficult is it to change later?
- **ADR Recommendation:** Does this deserve a formal ADR? Why / why not?

Recording a decision here never authorizes anything beyond what was already
approved: a decision with architectural significance is an ADR candidate and
requires developer approval before any ADR is created.

---

## Log

<!-- Entries are appended below in chronological order. -->

### 1. Development HMAC secret: random value instead of a constant placeholder

- **Task:** `_037-environment-governance.md`
- **Date:** 2026-11-13
- **Context:** Task 4 required populating `apps/api/env/.env.development`, including
  the required 64-hex-character `ENROLLMENTS_OTP_HMAC_SECRET`. The approved plan
  said "safe local-development placeholder" without fixing the concrete form.
- **Decision:** Generated a random value with `openssl rand -hex 32` into the
  gitignored local file, rather than inserting an obvious constant (e.g.
  `0…0` or `devsecret…`).
- **Reasoning:** The schema's own comment documents exactly this generation
  procedure per environment; a random dev key exercises the real format and
  avoids a guessable value sitting in a running dev instance.
- **Alternatives:** A fixed obvious placeholder (clearly non-secret, but
  guessable and prone to being copied to other environments); leaving it empty
  (rejected: fails the task's "populate existing variables" goal for a value
  that is safely determinable).
- **Trade-offs:** A random dev secret is indistinguishable from a real one if
  the file is screenshotted; mitigated by the file being gitignored and the
  in-file comment marking it development-only.
- **Impact:** Only the local `.env.development`; `.env.example` and
  `.env.production` remain empty/undocumented-by-design for this variable.
- **Reversibility:** Trivial — regenerate or replace at any time; OTP digests
  in the dev Redis would be invalidated by a change (acceptable in dev).
- **ADR Recommendation:** No — local configuration hygiene, not an
  architecture decision.

### 2. E2E Redis injection: explicit `createE2eTestApp` wrapper instead of suite detection

- **Task:** `_038-e2e-testcontainers.md`
- **Date:** 2026-11-13
- **Context:** ADR-025 passes the shared container's `RedisConfig` from the
  Vitest globalSetup to workers via `provide`/`inject`. `create-test-app.ts`
  is shared by the e2e suite (which provides the config) and the `test:redis`
  suites (which run under a config with no globalSetup and manage their own
  per-file containers — `inject()` would throw there).
- **Decision:** Added an explicit `createE2eTestApp()` wrapper that injects
  the provided config and delegates to `createTestApp`, which gained an
  optional `redisConfig` option; the 14 e2e specs were renamed to the wrapper
  while `test:redis` specs stay untouched.
- **Reasoning:** The wrapper makes the contract typed and explicit; any
  detection scheme (peeking at provided context, globalThis stashing, or
  swallowing the `inject()` error) would hide which suite manages containers
  and would rely on error suppression, which the project forbids.
- **Alternatives:** Unconditional `inject()` inside `createTestApp` (breaks
  the redis suites); a non-throwing availability probe (no such Vitest API);
  `globalThis` side-channel set from a setup file (hidden, untyped coupling).
- **Trade-offs:** A one-time mechanical rename across 14 spec files versus
  invisible control flow — the rename is discoverable in review, the magic
  would not be.
- **Impact:** `apps/api/test/create-test-app.ts` and all `*.e2e-spec.ts`
  files; `test:redis` behavior unchanged.
- **Reversibility:** Trivial — the wrapper is 5 lines over the base helper.
- **ADR Recommendation:** No — test-infrastructure detail covered by ADR-025's
  decision scope; the ADR documents the mechanism.

### 3. Config-namespace tokens: local provider in the owning module, not raw injection from ConfigModule

- **Task:** `_039-memory-load-shedding.md`
- **Date:** 2026-11-13
- **Context:** `MemoryProtectionService` needs its `MemoryProtectionConfig`
  injected for DI, and e2e specs must be able to override it with
  `overrideProvider(MEMORY_PROTECTION_CONFIG)`. Session experience showed
  `@nestjs/config`'s `ConfigService` holds `registerAs` factory results
  internally and ignores provider overrides on the namespace token (ADR-025
  validation), and the first validation run of this task failed all e2e suites
  because `ConfigModule`'s globally loaded token was not resolvable from the
  new module's own DI context.
- **Decision:** `MemoryProtectionModule` explicitly provides
  `{ provide: MEMORY_PROTECTION_CONFIG, useFactory: () => memoryProtectionConfig() }`
  so the service's `@Inject(token)` resolves locally and testing-module
  overrides replace exactly that binding. Consumers that only read config keep
  calling the factory function or `ConfigService` as before.
- **Reasoning:** Any module that injects a `registerAs` token directly must
  also provide it locally (or import a module that does) — relying on
  ConfigModule's global registration is not portable across module contexts,
  and `ConfigService.getOrThrow` would silently defeat e2e overrides (the
  ADR-025 trap).
- **Alternatives:** Inject `ConfigService` and `getOrThrow(token)` (breaks
  override-based testing — same trap); read `_env` directly in the service
  (bypasses the config-factory convention and cannot be overridden).
- **Trade-offs:** One extra pure factory call at boot and a provider entry
  that duplicates ConfigModule's registration for this token; in exchange,
  injection works in every context and overrides are honored.
- **Impact:** `MemoryProtectionModule` (and the e2e spec that overrides the
  token); sets the pattern for future config namespaces that need injectable
  tokens.
- **Reversibility:** Trivial — delete the provider entry if the service ever
  switches to factory-call style.
- **ADR Recommendation:** No — implementation detail of the already-approved
  ADR-026 configuration design; the trap itself is documented here and in the
  ADR-025 decision text.

### 4. MikroORM CLI TypeScript loading: `@swc-node/register` and the `#config` alias to compiled output

- **Context:** The `migration:*` CLI must load `mikro-orm.config.ts` (TypeScript, NodeNext, `verbatimModuleSyntax`) and reach the shared env-validation layer. MikroORM v7's CLI registers TS loaders in order (oxc, swc, tsx, jiti, tsimp, nub) but none was installed; the CLI cannot use Nest DI, so the URL comes from `_env`.
- **Decision:** Install `@swc-node/register` (devDependency) so the CLI's `swc` loader slot pairs with the existing `@swc/core`; the CLI config imports `_env` through the package `#config/env/env.config.js` alias, which Node resolves to the compiled `dist/` output inside the CLI process — keeping the CLI config free of parent-relative imports. The `db:migration:*` scripts therefore run `pnpm build &&` first (judge finding CR-03), eliminating both fresh-clone crashes and stale-schema drift.
- **Reasoning:** Reusing the project's SWC toolchain (ADR-003) instead of adding tsx/jiti/esbuild keeps one transpiler; peer ranges verified (`typescript >= 4.3 < 7` satisfies the 6.0.3 pin). The alias keeps the lint rule intact without a suppression comment.
- **Alternatives:** `tsx`/`jiti` (new transpiler, rejected); a compiled-JS-only CLI config (build-before-every-command friction, rejected); a lint-suppressed parent-relative import (rejected — convention violation).
- **Trade-offs:** One more devDependency bound to `@swc/core` version alignment; the CLI env chain executes from `dist/`, so the build prefix is load-bearing.
- **Impact:** `apps/api/package.json` (devDependency, scripts), `mikro-orm.config.ts` (alias import), ONBOARDING (dependency notes).
- **Reversibility:** Trivial — swap the loader or de-alias the import.
- **ADR Recommendation:** No — tooling detail within the approved ADR-027 integration; documented here and in the dependency notes.

### 5. Database test tiers: mirror the Redis tier, one shared e2e Postgres container, and a stubbed initializer for the real-Redis tier

- **Context:** With the boot-time connection (ADR-027 amendment), every tier that boots the full `AppModule` needs a reachable PostgreSQL. The e2e tier boots the app against a validation-only `DATABASE_URL` placeholder in the redis tier, whose tests never touch the database.
- **Decision:** (a) The new `test:db` tier mirrors the redis tier (per-file Testcontainers Postgres, sequential files, `MIKRO_ORM_MODULE_OPTIONS` override via a shared runtime-options builder). (b) The e2e globalSetup starts one shared Postgres container per run next to the shared Redis. (c) `createTestApp` gained an explicit `stubDatabaseConnect` option used by the rate-limit redis-spec (the only redis-tier file booting the full AppModule) so its boots stay instant instead of burning the bounded retry budget against the placeholder URL.
- **Reasoning:** Mirroring an existing, proven tier minimizes new infrastructure; the stub is explicit per call site (not inferred from `redisConfig`, which would also stub the e2e apps) and documented on the option.
- **Alternatives:** A Postgres container per redis-spec file (real but wasteful for a tier that never queries the DB); automatic stubbing whenever `redisConfig` is set (would silently stub e2e boots too — rejected); pointing the placeholder at a dead port (still burns the 15 s retry budget per boot).
- **Trade-offs:** The redis tier no longer boots a fully real DB connection; the e2e tier continues to cover the real boot path end to end.
- **Impact:** `create-test-app.ts`, `rate-limit.redis-spec.ts`, `e2e.global-setup.ts`, `database.db-spec.ts`.
- **Reversibility:** Delete the option and stub call sites.
- **ADR Recommendation:** No — testing strategy within the approved ADR-025/027 architecture.

### 6. Health-probe behavior: bounded at 3000 ms, unconditional `connect()`, single query

- **Context:** The v7 connection has no configurable connect timeout, `isConnected()` internally runs a `select 1` (doubling probe cost), and the Compose healthcheck timeout is 5 s — an inner bound of 5 s could race it and mark a live container unhealthy.
- **Decision:** The indicator probes via a shared `withTimeout` helper (`database.timeout.ts`, extracted from the indicator's private copy) at 3000 ms and calls `orm.connect()` unconditionally before `checkConnection()` — one query per probe.
- **Reasoning:** Judge findings CR-02/CR-05; `connect()` is idempotent and its dialect creation is synchronous, so concurrent probes cannot double-create the pool.
- **Alternatives:** Keep the `isConnected()` guard (two queries per probe); raise the Compose timeout (moves the problem instead of removing it).
- **Trade-offs:** A black-holed probe is reported as a timeout failure after 3 s rather than a driver-reported reason.
- **Impact:** `database.health.ts`, `database.timeout.ts`, the compose healthcheck interplay (documented in the constant's comment).
- **Reversibility:** Constants and call shape are trivially adjustable.
- **ADR Recommendation:** No — implementation detail of the approved ADR-026/027 health semantics.

### 7. Dev environment credential repair via `ALTER USER` instead of volume reset

- **Context:** The pre-existing `postgres_dev_data` volume (created 2026-11-10) initialized with older credentials; `POSTGRES_PASSWORD` only applies on first init, so the running dev Postgres rejected the current env-file password. The volume predates any schema or data (no DB feature ever ran), but it is shared developer state.
- **Decision:** Align the role to the current `docker/env/.env.docker.dev` value with `ALTER USER` executed inside the container (local-socket auth, value never printed), rather than deleting/recreating the volume. While fixing this, the password quoting mismatch flagged by judge finding CR-01 was also corrected in `.env.development`.
- **Reasoning:** Non-destructive, fast, and keeps the volume, env file, and app config consistent; a volume reset would have achieved the same end state with an irreversible delete of shared state.
- **Alternatives:** `docker volume rm` + re-init (destructive; identical outcome); matching the app to the volume's unknown old password (impossible).
- **Trade-offs:** The role password is now maintained manually until the volume is re-initialized; a future volume reset must be followed by no action (init uses the env-file value).
- **Impact:** Local dev environment only (no repository change beyond the CR-01 env fix).
- **Reversibility:** Re-running `ALTER USER` with any value.
- **ADR Recommendation:** No — local operations decision, recorded for traceability.

### 8. pgAdmin server-definition render target: `/tmp` + documented `PGADMIN_SERVER_JSON_FILE` override (ADR-028 task)

- **Context:** ADR-028's approved mechanism renders `servers.json` at container startup from a mounted template. pgAdmin's default read path is `/pgadmin4/servers.json`, but the image runs as uid 5050 and that directory is not writable by it — the first runtime boot failed with `PermissionError` (judge Wave 6 CR-04 later also tied the path to the documented override contract).
- **Decision:** Render to `/tmp/servers.json` (per-container scratch) and set the documented `PGADMIN_SERVER_JSON_FILE=/tmp/servers.json` environment variable; the render script derives its output path from that variable with `/tmp/servers.json` as the default (single source of truth).
- **Reasoning:** `/tmp` is writable by the container user, exists in the image, and is per-container ephemeral — the rendered file (which contains the dev PostgreSQL password) never lands in tracked files or in the `pgadmin_data` volume; pgAdmin's own first-launch import into its configuration database on the volume remains the only persisted copy, which `docs/docker.md` documents. Alternatives rejected on impact: running the container as root (widens privileges for no benefit), a tmpfs mount for a writable `/pgadmin4` path (extra compose machinery for the same outcome), and writing into the volume (would persist a second, plain-text password copy).
- **Alternatives:** Render directly to `/pgadmin4/servers.json` via a root-writable mount or `user: root` (privilege widening — rejected); tmpfs mount at `/pgadmin4/rendered` + `PGADMIN_SERVER_JSON_FILE` (equivalent outcome, more compose surface — rejected); write the rendered file into the persistent volume (second plain-text credential copy — rejected).
- **Trade-offs:** The definition is re-rendered on every container start (idempotent and intentional); the file lives in container scratch, invisible to host-side inspection of the volume.
- **Impact:** `docker/pgadmin/render_servers.py` (default path + `PGADMIN_SERVER_JSON_FILE` handling), `docker/compose.app.dev.yml` (one environment line).
- **Reversibility:** Trivial — change `DEFAULT_RENDERED_PATH`/the compose variable together (they share one source of truth by contract).
- **ADR Recommendation:** No — implementation detail within the approved ADR-028 mechanism (the ADR never specified the render target); recorded here and in the Wave 6 tracker entry.

### 9. TypeHealth audit scope: production findings fixed, generated code and test-idiom findings intentionally left (typehealth task)

- **Context:** The user-added `typehealth` analyzer reports per-metric findings across the three workspaces. The raw baseline (99.4%/75.6%/n-a) mixes production source, test files, framework-generated code, and solution-tsconfig artifacts.
- **Decision:** Fix only production-source findings (api `src/` implicit-any ×8, admin root-element `!`), and leave three classes open with recorded justification: (a) Next.js `.next/types/validator.ts` codegen (not project source; tsconfig exclusion would affect Next's route type checking), (b) 30 test-file findings where `as unknown as` is the repo's established Vitest mock idiom, (c) the `openapi.schemas.ts` JSON round-trip (internally generated JSON; typed alternatives need an unsafe assertion or change drop-undefined semantics). Also established that `apps/admin` must be scanned with `tsconfig.app.json` — its solution-style root tsconfig yields a false 0-file report with 9 "disabled" flags although both real configs are strict.
- **Reasoning:** The skill's own rules (findings are signals, don't game metrics, respect conventions) plus the repo's DRY/convention rules: converting the test-idiom assertions would fight the surrounding code for zero runtime safety; the JSON.parse call is a non-boundary by construction.
- **Alternatives:** Fix every finding including tests (high churn, convention conflict — rejected); exclude `.next` and test globs from scans to clean the report (metric gaming — rejected); switch the JSON round-trip to `structuredClone` (semantics change for undefined-valued properties — rejected).
- **Trade-offs:** The headline metrics stay below 100% (api 99.7%, web 75.6% reported); the reports now have a documented interpretation layer instead of a misleading raw number.
- **Impact:** `apps/api/src/shared/{filters,interceptors,logging}`, `apps/admin/src/main.tsx`, `README.md` (scan command + admin config note), `prompts/_045`.
- **Reversibility:** Trivial — annotations only; re-introducing the raw idioms is a one-line revert each.
- **ADR Recommendation:** No — tool usage and annotation-level fixes; no architectural decision.

### 10. Explicit string-mode `BigIntType` instances instead of the `type: 'bigint'` string form (shared BaseEntity task)

- **Context:** The BaseEntity needs BIGINT columns whose TypeScript representation is `string`. MikroORM 7.2.9 offers the string form (`type: 'bigint'`) and the documented explicit form (`type: new BigIntType('string')`). Source verification showed the string form's runtime hydration mode depends on metadata the pipelines provide: `ReflectMetadataProvider` skips `runtimeType` inference when an explicit type is set, and the vitest transformer (oxc via Vite 8) emits no `design:type` for initialized fields — the metadata-unit test failed with hydration mode resolving to JS `bigint` for the audit columns, which would have corrupted the string contract at runtime.
- **Decision:** Declare every BIGINT property (`id`, `createdBy`, `updatedBy`) with an explicit fresh `new BigIntType('string')` instance (plus explicit `autoincrement: true` on the PK, since the base `bigserial` inference path checks `columnTypes[0] === 'bigint'`, which the explicit type bypasses), and assert the resolved runtime type in the metadata spec.
- **Reasoning:** The explicit instance is deterministic across tsc, SWC (production build), and oxc (test transform) regardless of `design:type` emission, is the pattern the version-matched official documentation shows for string-mapped BIGINTs, and converts every direction explicitly (including `toJSON`/`fromJSON` validation). Per-property instances avoid the type object's discovery-mutated state (`customType.meta`/`.prop`) being shared across three properties.
- **Alternatives:** `type: 'bigint'` + relying on the discovery mode-sync for the PK and on design:type for the rest (transformer-dependent — failed the metadata test — rejected); `declare`-keyword field declarations (swc/oxc drop decorated declarations entirely — rejected); `columnType: 'bigint'` (same string-form ambiguity — rejected).
- **Trade-offs:** Three small `new` allocations at module load; a slightly more verbose decorator.
- **Impact:** `apps/api/src/shared/database/base.entity.ts`, `apps/api/src/shared/database/base.entity.spec.ts`, the fixture entity's explicit typing, `prompts/_047` (decision 1), Wave 15 tracker context.
- **Reversibility:** Trivial — swap the decorator type per property.
- **ADR Recommendation:** No — implementation detail within the approved ADR-029 design (the ADR mandates BIGINT→string, not the decorator form).

### 11. `Opt<T> | null` property typing and a probe-controller lock+flush boundary (shared BaseEntity task)

- **Context:** Base-entity fields with initializers (`createdAt = new Date()`, `updatedAt = null`, …) are required in `em.create()` input data by MikroORM's `RequiredEntityData` unless marked optional; `Opt<T> = T & Brand` is not distributive over unions, so `Opt<Date | null>` fails to typecheck against a `null` initializer. Separately, the db-tier optimistic-locking tests showed `flush()` itself raises `OptimisticLockError` when the versioned UPDATE loses a concurrent race — mapping only `em.lock` would leak a raw 500 to the client.
- **Decision:** Initialized base properties are typed `Opt<T> | null` (or `Opt<T>` for non-nullable) — optional in `em.create` input while preserving `Date | null` reads — and the documented production pattern for update workflows wraps both `em.lock` and `flush()` inside the `mapOptimisticLockError` boundary (implemented in the test-only probe controller; mirrored in `apps/api/AGENTS.md`).
- **Reasoning:** `Opt` cannot wrap unions, and the `?` optional marker would widen reads to include `undefined`, breaking the `Date | null` contract; the lock+flush boundary is the only shape that covers the verified flush race (proven by the concurrent-race db-spec where exactly one request must get 409).
- **Alternatives:** `?: Date | null` optional markers (widens the read type — rejected); `[OptionalProps]` on the base (uncertain inheritance through the inlined-abstract discovery pass; `Opt` is the documented mechanism — rejected); mapping only `em.lock` (leaks flush-race 500s — rejected).
- **Trade-offs:** The `Opt` brand appears in the declared types (purely phantom at runtime); update services must remember to include the flush inside the mapped try block (convention, documented).
- **Impact:** `apps/api/src/shared/database/base.entity.ts`, `apps/api/test/fixtures/test-article.controller.ts`, `apps/api/AGENTS.md` (locking pattern), `prompts/_047` (decisions 2 and 4).
- **Reversibility:** Trivial — typing and a try-block boundary.
- **ADR Recommendation:** No — typing-level and convention-level details inside the approved ADR-029 mechanism.

### 12. Test-tier decisions for the BaseEntity suite (shared BaseEntity task)

- **Context:** The db tier boots the real AppModule with no Redis; the global throttler guard guards every route, so a fixture probe over HTTP would fail against the placeholder Redis; fixture entities must be discoverable without leaking into production discovery; and the Intl formatter cache in the new `utc-datetime` helper had to be hardened after the security gate (SEC-01).
- **Decision:** db-specs override `ThrottlerStorage` with the official in-memory `ThrottlerStorageService` (test-scoped only); fixture entities ride in the explicit `entities` option of the `MIKRO_ORM_MODULE_OPTIONS` override together with `BaseEntity` (the MikroORM rule for explicit entity lists); the `wallClockFormatter` cache canonicalizes zones via `resolvedOptions().timeZone` before caching.
- **Reasoning:** Reuses the documented test-override mechanism without touching production modules or `create-test-app.ts`; the in-memory storage keeps the guard functional per the tier's contract ("Redis is never contacted here"); canonicalization bounds the cache to the finite canonical zone set and was the security judge's recommendation.
- **Alternatives:** Excluding probe paths from the throttler in production config (production surface change for a test need — rejected); a `forFeature` test module import (requires `create-test-app.ts` API changes — rejected); capping/evicting the formatter cache (canonicalization is simpler and also deduplicates link aliases — judge-endorsed — rejected alternatives).
- **Trade-offs:** db-specs that add probe routes must remember the storage override (two specs carry it); one transient small allocation per `calendarDayUtcRange` call.
- **Impact:** `apps/api/test/base-entity.db-spec.ts`, `apps/api/src/shared/datetime/utc-datetime.ts`, `docs/judge-findings.md` (Wave 15 SEC-01), `prompts/_047` (decisions 4–5).
- **Reversibility:** Trivial — test-config-only changes; the canonicalization is one line.
- **ADR Recommendation:** No — test strategy and a judge-remediation hardening; no architectural decision.
