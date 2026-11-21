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

### 13. Root-level not-found fallback via a post-init prefix-less adapter registration (NodeAdapter migration task)

- **Context:** Nest core mounts its not-found handler only under the global prefix, so with NodeAdapter, unmatched paths outside `/api` (e.g. `GET /healthz`) would receive the adapter's plain-text 404, whereas Fastify had served Problem Details instance-wide. The developer directed that the Problem Details contract be kept everywhere and rejected the duplicate-pipeline options; a wildcard controller was rejected because it would route 404s through guards (throttler counting, memory-protection 503s), changing in-prefix semantics.
- **Decision:** The bootstrap registers a second, prefix-less `adapter.setNotFoundHandler` after `app.init()` (so it sits behind the routes, the prefix-scoped mount, and the excluded root routes, and cannot shadow the health probes), which responds directly with Problem Details built through the same shared building blocks as the filter (`normalizeHttpException`/`localizedProblemTitle`, extracted for this purpose) and is self-sufficient for the request ID (uses the lifecycle-assigned `req.id` when valid, resolves otherwise).
- **Reasoning:** Reusing core's exception pipeline was not possible (the adapter's error middleware sits earlier in the chain than any post-route fallback, and connect error handling only scans forward), so a direct response with shared building blocks was the only shape with zero contract drift; the empty-prefix registration path already exists in the adapter for prefix-less apps and skips registered prefixes at runtime.
- **Alternatives:** wildcard root controller with `@SkipThrottle` (changes guard semantics for 404s and needs prefix-exclusion gymnastics — rejected); re-throwing into `next(err)` (error middleware is earlier in the chain, unreachable — rejected); leaving plain-text 404s outside the prefix (rejected by the developer).
- **Trade-offs:** a second 404 code path in the bootstrap boundary; the contract-building helpers moved from private filter methods to exported functions.
- **Impact:** `apps/api/src/shared/http/not-found.fallback.ts`, `src/main.ts`, `test/create-test-app.ts` (mirror), `test/app.e2e-spec.ts` (regression case), ADR-032 compatibility list, Wave 18/19 tracker.
- **Reversibility:** Contained — one registration function plus the bootstrap call.
- **ADR Recommendation:** No — the behavior decision was explicitly approved by the developer during ADR-032 implementation; the mechanism is recorded here and in ADR-032's mapping.

### 14. HTTP boundary contracts, behavioral adapter tests, and test-infra repairs (NodeAdapter migration task)

- **Context:** The shared components (filter, envelope, guard) needed platform-neutral request/response typing; the e2e suite needed to prove adapter configuration behavior rather than introspect internals; three test files carried pre-existing defects unrelated to but surfaced by the migration.
- **Decision:** (a) App-owned `HttpRequestLike`/`HttpResponseLike` contracts in `src/shared/http/http-boundary.ts`, with `id?: unknown` because the platform's IncomingMessage augmentation declares the wider `ReqId` and every consumer stringifies; (b) the body-limit and trust-proxy e2e specs verify behavior (413 on an oversized body, `req.ip` resolution through a probe controller) instead of Fastify-era config introspection; (c) pre-existing test defects fixed in passing: the enrollments e2e Redis stub (`useValue` was literally `undefined` in both branches of a dead ternary since 0a7072b → stub object consumed by `overrideRedisService`), the base-entity db-spec raw SQL (`$1` placeholder that MikroORM 7's Kysely layer does not bind → `?`, and a global-EM use outside a RequestContext → explicit `fork()`).
- **Reasoning:** Structural contracts are the documented platform-agnosticism pattern and keep NodeRequest/NodeResponse assignable; behavioral assertions survive future adapter swaps; the test defects had to be fixed because the tiers must be green to validate the migration, and each fix was the minimal one preserving the test's intent.
- **Alternatives:** importing NodeRequest/NodeResponse types in shared components (violates the new root rule — rejected); asserting `initialConfig`-style internals on the new adapter (none exposed — moot); leaving the broken specs for a separate task (blocked required validation — rejected).
- **Trade-offs:** the contract's `unknown` id is looser than the runtime guarantee; one more boundary file.
- **Impact:** `src/shared/http/http-boundary.ts`, the four re-typed shared components, `test/http-config.e2e-spec.ts`, `test/enrollments.e2e-spec.ts`, `test/base-entity.db-spec.ts`.
- **Reversibility:** Trivial per piece.
- **ADR Recommendation:** No — implementation choices inside the approved ADR-032 scope.

### 15. ETag/conditional-request mechanism and throttler-tracker bounding (NodeAdapter follow-up task)

- **Context:** The deferred items from the NodeAdapter migration were directed for implementation: restore ETag/304 support, cover the allowlist-narrowed trust path with e2e tests, and bound the throttler tracker's Redis key cardinality in the documented trust-all state.
- **Decision:** (a) ETags are computed in a global `ConditionalRequestInterceptor` registered after the response envelope — which makes it INNERMOST, so its `map` sees the handler payload BEFORE the envelope wraps it; the validator is therefore WEAK (`W/"<sha256>"`, `weakEtag`) over the application payload, explicitly not claiming byte-identity of the wire body (the envelope adds fresh timestamp/request ID per response; `If-None-Match` compares weakly per RFC 9110 §13.1.2, so revalidation works). A matching `If-None-Match` on GET/HEAD sets the status to 304 and returns the data unchanged: the adapter's `writeBody` calls `endWithoutBody`, which strips Content-Type and ends 304s body-less on every reply path (no second send; `writeHead` is never reached for a 304). Problem Details responses are tagged through the filter, and the two bootstrap error paths (request-ID rejection, root not-found fallback) tag through the same helpers — none of them revalidate because their bodies embed fresh timestamp/request IDs (matching the Fastify-era behavior). Scope: SSE routes skipped (no single JSON representation). (b) `CreateTestAppOptions.adapterTrustProxy` widened to `boolean | string[]` and two e2e cases prove the narrowed path (loopback allowlist honors XFF; non-matching allowlist ignores it). (c) The throttler guard bounds the tracker: when the tracker equals the resolved `req.ip` and is not a valid IP (the default tracker consuming a garbage forwarded value in the trust-all state), it falls back to the socket address; the comparison against `req.ip` leaves route-supplied custom trackers untouched.
- **Reasoning:** Interceptor-side hashing was the only placement with a single send and byte-identical serialization; adapter hooks run after the response is already on the wire. The `tracker === req.ip` comparison avoids importing the library's internal `normalizeIp` (not re-exported) while distinguishing default-tracker output from custom trackers.
- **Alternatives:** adapter `setOnResponseHook` (runs after the body is sent — cannot suppress or 304 — rejected); hashing inside the envelope interceptor (conflates two concerns; envelope exclusions would silently drop ETags — rejected); emitting 304 from the interceptor and returning an empty observable (the adapter would send again on an ended response — rejected); rejecting all non-IP trackers (would break hypothetical route-supplied user-based trackers — the `req.ip` comparison is the precise seam).
- **Judge-iteration corrections (Wave 20):** the first implementation claimed a strong tag "after the envelope" — the reviewer proved the registration order makes the interceptor innermost (its map runs first) and the tag strong-incorrect; the rework introduced the weak validator, removed a dead content-type pre-set whose justifying comment described adapter behavior that does not exist (`endWithoutBody` ends 304s before `writeHead`), dropped the filter's unreachable 304 branch, added the SSE skip, and unified the three `isRecord` copies into one export.
- **Trade-offs:** one more global interceptor and one hashing pass per JSON response (SHA-256 over the serialized body — measured irrelevant at this scale); HEAD clients get no validator; error-response ETags never match by construction.
- **Impact:** `apps/api/src/shared/http/etag.ts` (+spec), `conditional-request.interceptor.ts`, `problem-details.filter.ts`, `app.module.ts`, `redis-throttler.guard.ts`, `test/conditional-request.e2e-spec.ts`, `test/http-config.e2e-spec.ts`, `test/create-test-app.ts`, `DEFERRED.md` (item Done), ADR-032 (ETag bullet amended), `docs/current-state.md`.
- **Reversibility:** Remove the interceptor registration and the filter/guard additions; no contract depends on the headers.
- **ADR Recommendation:** No — the restoration was already directed and recorded in ADR-032/DEFERRED.md; the mechanism choices are implementation details.

### 16. Bootstrap-hook sequencing for the connection lifecycle logger (database governance task _051)

- **Context:** ADR-034 placed pool-event registration in a new provider whose bootstrap hook must run strictly after `DatabaseConnectionInitializer`'s bounded-retry connect. The first implementation assumed that provider-array order sequences `onApplicationBootstrap` hooks; the code reviewer proved against the installed `@nestjs/core` 12.5.0 sources that same-level providers' bootstrap hooks run concurrently (`on-app-bootstrap.hook.js`), so the logger's `isConnected()` guard would have deterministically seen the pre-connect state and skipped registration on every cold start (tracker Wave 21 CR-01).
- **Decision:** `DatabaseLifecycleLogger` constructor-injects `DatabaseConnectionInitializer`, creating a real DI dependency edge that makes Nest instantiate the initializer first and order the bootstrap hooks sequentially; the `isConnected()` guard is retained for the `stubDatabaseConnect` test tiers, and the ADR-034 mechanism sentence was amended to describe the edge (marked amendment note; the decision itself is unchanged).
- **Reasoning:** The DI edge is the framework-supported way to express hook ordering; it changes no behavior or ownership, keeps the lifecycle-observation concern in its own provider, and is provable by a real-boot db-spec assertion (`listenerCount` on the container pool).
- **Alternatives:** folding listener registration into `DatabaseConnectionInitializer` (conflates connect establishment with observability and would amend ADR-034's design — rejected); re-deriving order from a custom ordering mechanism (over-engineering for a two-provider module — rejected); accepting the concurrent race and re-attaching on the first pool event (nondeterministic — rejected).
- **Trade-offs:** the injected initializer exposes no runtime API the logger needs (documented as a sequencing edge); one constructor dependency more.
- **Impact:** `apps/api/src/shared/database/database.lifecycle.ts`, `database.module.ts`, `test/enrollment.db-spec.ts` (real-boot registration proof), DECISIONS.md ADR-034 mechanism note, Wave 21 tracker.
- **Reversibility:** Trivial (drop the constructor parameter).
- **ADR Recommendation:** No — the design decision was already accepted in ADR-034; this is a mechanism correction inside its scope, tracked and marked in the ADR text.

### 17. Database-tier entity overrides: `autoLoadEntities: false` with complete explicit lists (database governance task _051)

- **Context:** With the first real `forFeature([Enrollment])` registration in `EnrollmentsModule`, the database tier broke: `@mikro-orm/nestjs` 7.1.0 copies `forFeature` registrations into `entitiesTs` whenever `autoLoadEntities` is on (`mikro-orm.providers.js`), and TypeScript-mode discovery (Vitest) uses `entitiesTs` INSTEAD of `entities` — so db-spec overrides with explicit fixture entity lists were silently reduced to just the autoloaded entities (`MetadataError: Metadata for entity TestArticle not found`), and with `autoLoadEntities: false` the real `forFeature` repository provider resolves eagerly and requires its entity in the explicit list.
- **Decision:** Every `MIKRO_ORM_MODULE_OPTIONS` test override that supplies an explicit entity list sets `autoLoadEntities: false` and lists the complete set (fixture entities + `BaseEntity` + every `forFeature`-registered entity in the booted module tree); the e2e factory, which supplies no explicit list and relies on real discovery, keeps `autoLoadEntities: true`. The rule is documented in `apps/api/AGENTS.md` Database Rules.
- **Reasoning:** Explicit lists are deterministic regardless of registration order and discovery mode, and the failure mode without the flag is silent metadata loss, not a boot error; the eager repository resolution makes partial lists fail loudly, which argues for the complete-list rule.
- **Alternatives:** keeping `autoLoadEntities: true` in db-spec overrides and relying on `entitiesTs` (ignores the explicit list — the observed bug); suppressing `entitiesTs` in the integration package (out of scope, upstream behavior); per-file ad-hoc fixes without a documented rule (would regress with the next entity).
- **Trade-offs:** future entities must be added to affected db-spec lists (lint/typecheck will not catch a missing one — the eager repository resolution turns it into a boot-time `MetadataError` in that tier, which is the detection mechanism).
- **Impact:** `apps/api/test/base-entity.db-spec.ts`, `test/enrollment.db-spec.ts`, `apps/api/AGENTS.md`, prompts/_051 gotcha note.
- **Reversibility:** Trivial per file.
- **ADR Recommendation:** No — testing convention, not architecture; captured in the workspace agent instructions.

### 18. oxfmt normalization of the generated migration (database governance task _051)

- **Context:** The MikroORM CLI generated `Migration20261116181139.ts`; the formatter (`oxfmt --write .` over the workspace, which lint-staged will also run on commit) rewrapped the two `addSql(...)` call sites after generation but after the migration had already been executed against the dev database and approved by the migration reviewer, while the root AGENTS.md immutability rule forbids editing existing migrations.
- **Decision:** Keep the formatted file rather than restoring the CLI's byte-exact output, treating whitespace-only normalization that does not alter any SQL string as outside the immutability rule's intent; the fact is recorded in the prompt record.
- **Reasoning:** The immutability rule protects schema semantics and the review/apply correspondence — the executed DDL is byte-identical (only call-site line wrapping changed), and fighting the formatter would make lint-staged rewrite the file at commit time anyway, recreating the same file state under less review.
- **Alternatives:** restoring the CLI formatting byte-for-byte (would be re-formatted by the commit hook — rejected); excluding migrations from oxfmt (a tooling carve-out for one file — rejected as unjustified).
- **Trade-offs:** the file on disk differs in whitespace from what the CLI printed at generation time; the SQL is unchanged.
- **Impact:** `apps/api/src/shared/database/migrations/Migration20261116181139.ts` only.
- **Reversibility:** Trivial.
- **ADR Recommendation:** No — interpretation of an existing policy for a whitespace-only case; recorded here and in the prompt record. If a future migration ever needs a semantic post-generation change, the immutability rule governs and a new forward migration is required.

### 19. Minimal coverage exclude list under Vitest's replace-semantics (test orchestration task _052)

- **Context:** Vitest 5's `coverage.exclude` **replaces** the built-in default exclude list (it does not merge), so any explicit exclude must re-cover everything that matters. The scope is bounded by `coverage.include: ['src/**']` (which is also the Vitest 5 mechanism for counting untested files, `coverage.all` no longer existing), so only `src/` content can ever reach the report.
- **Decision:** The exclude list is exactly `['src/**/*.spec.ts', 'src/**/migrations/**']` — the unit specs and the generated migrations — with no speculative entries (e.g. `**/*.d.ts`, fixture globs), and reporter list exactly `['text', 'html', 'lcov']` per the task requirements, replacing Vitest's default `['text', 'html', 'clover', 'json']`.
- **Reasoning:** `include` bounds the universe, so the two excludes are the only known non-source content under `src/` (verified: `src/` contains no `.d.ts` or fixture directories); generated migrations are machine output per the governance rules and measuring them would flatter nothing; speculative excludes would silently hide future real source from the report — the opposite failure mode is worse than an extra table row.
- **Alternatives:** spreading a copy of Vitest's full default exclude list (fragile against upstream changes, unnecessary under `include` — rejected); excluding only migrations and keeping spec coverage rows (noise, standard practice excludes specs — rejected); `coverage.enabled: true` in config (would tax every plain unit run; the CLI `--coverage` flag on `test:coverage` enables it on demand — rejected).
- **Trade-offs:** a new non-`src` source root (e.g. `packages/` shared code imported by tests) would need `include` widened — the config comment points at the mechanism; no thresholds exist yet, so the honest ≈75% baseline is the gate, not the excludes.
- **Impact:** `apps/api/vitest.config.ts` (coverage block), `prompts/_052-*.md` (baseline numbers), ADR-035 (unit-tier coverage decision).
- **Reversibility:** Trivial — one config object.
- **ADR Recommendation:** No — configuration detail inside the accepted ADR-035 scope; the untested-file-counting mechanism (`include`) is recorded here and in the prompt record because it replaces the removed `coverage.all` option.

### 22. The health-probe deadline timer is deliberately NOT unref'd (health hardening task _053)

- **Context:** The established pattern in this codebase unref's auxiliary timers so a termination signal is not held hostage (e.g. `DatabaseConnectionInitializer`'s retry backoff, `MemoryProtectionService`'s sample interval). The health probe's 3 s deadline timer is the only thing that guarantees a hung probe's client is released; graceful shutdown closes the ORM pool (`pool.end()` waits for every checked-out client to be released).
- **Decision:** Keep the probe deadline timer ref'd (default `setTimeout` behavior) even though an unref'd timer would let the process exit sooner during an in-flight probe.
- **Reasoning:** With an unref'd deadline timer and no other pending work, a shutdown racing a black-holed probe would exit before the timer fires, the borrowed client would never be released, and `pool.end()` inside the ORM's `onApplicationShutdown` would hang indefinitely — the unref would trade a bounded 3 s shutdown drain for an unbounded one. The ref'd timer makes the worst-case shutdown drain exactly the probe deadline (verified: deadline → errored release → pg-pool eviction → pool end completes).
- **Alternatives:** unref + a dedicated shutdown hook that force-releases in-flight probe clients (a second shutdown mechanism for a problem the ref'd timer already solves — rejected as redundant lifecycle surface); no deadline at all (the pre-fix behavior — rejected, it is the vulnerability).
- **Trade-offs:** a pending probe adds up to 3 s to shutdown latency in the pathological case; normal probes settle in milliseconds.
- **Impact:** `apps/api/src/shared/database/database.probe.ts` only.
- **Reversibility:** Trivial.
- **ADR Recommendation:** No — an implementation detail of the accepted ADR-036 reclaim mechanism; recorded because it deliberately diverges from the codebase's unref convention.

### 23. Schema-local blank-value normalization for DATABASE_POOL_MAX (health hardening task _053)

- **Context:** `validateEnv` passes raw strings into the Zod schemas, so `DATABASE_POOL_MAX=` reaches the schema as `''`; the documented contract (`.env.example`: "Leave empty to use the default") and the repo convention stated in `validation-helpers.ts` ("blank values are treated as unset") require it to behave like an absent variable, while `z.coerce.number('')` → `0` fails `.positive()`.
- **Decision:** Normalize inside the `DATABASE_POOL_MAX` schema itself — `z.preprocess` mapping a trimmed-empty string to `undefined` before `positiveSafeInteger(...).default(10)` — rather than stripping empty strings centrally for all variables in `validateEnv`.
- **Reasoning:** The central option would silently change the semantics of every existing schema (mandatory variables like `DATABASE_URL` and `REDIS_PASSWORD` would turn "explicitly empty" into "absent", flipping validation errors into default/credential mismatches) for a need one variable has; the local preprocess preserves the convention where it is actually documented. A first implementation used a `z.string().transform(...).pipe(...default)` chain and broke the whole env-validation layer at runtime — `z.string()` rejects `undefined` input before the default ever applies — which is why the preprocess form (unknown input) is the recorded shape.
- **Alternatives:** central blank-stripping in `validateEnv` (cross-cutting semantic change — rejected); dropping the "leave empty" documentation from `.env.example` instead (would contradict the repo convention and degrade the operator experience — rejected).
- **Trade-offs:** the blank-means-unset convention is enforced per-schema rather than globally, so future optional numeric variables must repeat the preprocess (the schema comment points at the convention).
- **Impact:** `apps/api/src/shared/config/env/schema/db.env.ts` (+spec cases), `.env.example` documentation.
- **Reversibility:** Trivial.
- **ADR Recommendation:** No — configuration detail within ADR-036's accepted scope; recorded because the first attempt revealed a non-obvious Zod pitfall (string-headed chains reject `undefined` before `.default`) that the next optional numeric variable will hit.

### 24. Toxiproxy black-hole assertions without status mocking or private internals (Redis reliability task _054)

- **Context:** The master prompt forbids substituting a plain Redis shutdown for the black-hole scenario, forbids relying on private ioredis internals, and requires proving the full recovery chain (bounded rejection → socket destruction → fast-fail → recovery) against a real server. ioredis exposes no public API to inject faults or observe its internal command queue.
- **Decision:** The redis-tier fault-injection spec routes a real client through the Toxiproxy proxy and asserts exclusively on public surface: command promise outcomes and `client.status` polling (a plain interval helper, not event listeners), with the fault expressed as `timeout` toxics on both stream directions. The fast-fail assertion deliberately exploits a _verified_ protocol property — with data black-holed, the AUTH/ready-check handshake can never complete, so the client can never reach `ready` while the fault is active, making the "commands fail immediately while not ready" assertion deterministic without mocking.
- **Reasoning:** Status polling avoids listener side effects inside assertions; handshake-impossibility gives the fast-fail case a deterministic precondition instead of a timing race; private-structure inspection (`commandQueue`) was rejected because the master prompt rules it out and behavioral assertions (bounded rejection, recovery, at-most-once INCR) capture the guarantee that matters.
- **Alternatives:** faking `client.status` via property assignment (tests a mock, not the lifecycle — rejected); asserting `waitingCount`/private fields (forbidden surface — rejected); only testing `commandTimeout` rejection without the socket-destruction chain (leaves the ADR-037 core mechanism unproven — rejected).
- **Trade-offs:** the spec depends on Toxiproxy semantics (`timeout` toxic = silent data stop) rather than a NIC-level fault; test deadlines (command 1500 ms / socket 2500 ms) are shorter than production (5000/6000) but preserve the ordering being proven.
- **Impact:** `apps/api/test/redis-black-hole.redis-spec.ts`, `apps/api/test/testcontainers.ts` (TestRedis network options).
- **Reversibility:** Trivial.
- **ADR Recommendation:** No — test strategy inside ADR-037's accepted scope; recorded for the fault-injection reasoning that future network-failure tests will reuse.

### 25. REDIS_SOCKET_TIMEOUT_MS ships with the blank-tolerant preprocess pattern from day one (Redis reliability task _054)

- **Context:** The new `REDIS_SOCKET_TIMEOUT_MS` env variable was added to `redis.env.ts`, whose existing numeric variables still carry the `positiveSafeInteger(...).default(...)` blank-value trap deferred as CR-05 (an empty `.env.example` entry coerces `''` → `0` → startup failure).
- **Decision:** The new variable uses the `z.preprocess` blank-to-unset pattern from the start and ships as an empty `.env.example` entry with a documented default, even though the file's siblings remain on the broken pattern.
- **Reasoning:** Adding a sixth instance of a known defect class (documented in `docs/ai-decisions.md` #23 and the deferred registry) would be a fresh mistake the review rules exist to prevent; but mass-fixing the five siblings remains outside this task's approved scope, so only the new variable is correct-by-construction.
- **Alternatives:** fixing all siblings now (unapproved scope expansion — rejected; stays deferred as CR-05); shipping the new variable on the broken pattern for file consistency (deliberately introducing a startup-failure trap — rejected).
- **Trade-offs:** `redis.env.ts` temporarily mixes two patterns until the CR-05 follow-up normalizes the siblings.
- **Impact:** `apps/api/src/shared/config/env/schema/redis.env.ts`, `.env.example`.
- **Reversibility:** Trivial.
- **ADR Recommendation:** No — application of the documented Zod pitfall lesson within ADR-037's scope.
- **Update (2026-11-17, same day):** the code reviewer flagged (Wave 24 CR-01) that the _claim_ of the repo-wide convention made the sibling inconsistency worse, so the Redis portion of this decision was revised within the task: a shared `positiveIntegerEnv(field, default)` helper now implements the blank-tolerant pattern for all five Redis numeric fields (Wave 24 CR-01 resolution), and `BODY_LIMIT` remains the only deferred sibling (see `DEFERRED.md`).

### 26. `If-None-Match: *` is honored only as the entire field value (ETag/Conditional GET task _055)

- **Context:** Phase 0's interim parser accepted `*` as any list candidate
  (`"other", *` revalidated). The Phase 2 mandate required RFC 9110-compliant
  parsing, and the grammar defines the field value as `*` OR an entity-tag
  list — never both.
- **Decision:** the strict parser treats a wildcard only when it is the
  entire trimmed field value; a `*` inside a list is a malformed candidate
  and is ignored (the pre-existing unit case asserting the lenient behavior
  was updated to the strict contract with a comment, per the task-integrity
  rule — a documented contract change, never a weakening).
- **Reasoning:** honoring an in-list wildcard would answer `304` to a
  field value the ABNF calls malformed, contradicting the master prompt's
  "follow RFC 9110" and "do not silently transform malformed input". The
  lenient reading is not required for safety (a 304 pairs with a valid ETag
  echo either way); strictness keeps the parser's malformed-input posture
  uniform. `*` as the whole value remains RFC-defined wildcard semantics.
- **Alternatives considered:** keeping the lenient in-list wildcard
  (rejected — normalizes malformed input); rejecting the entire field when
  `*` appears in a list (rejected — per-candidate ignore still matches a
  valid sibling such as `"abc123", *`, whereas whole-field rejection would
  turn that legitimate revalidation into a full 200; the per-candidate
  posture is the documented ADR-038 §4 behavior).
- **Trade-offs:** clients sending malformed `*, "tag"` lists get full 200
  responses instead of 304s — a false negative, never a false positive.
- **Impact:** wildcard revalidation works exactly as RFC-defined; the
  behavioral delta only affects non-conformant client input.
- **Reversibility:** trivial (one branch in `if-none-match.ts`).
- **ADR Recommendation:** None — the choice is an interpretation of the
  accepted ADR-038 §4 wording ("`*` matches any current representation",
  "malformed values ignored"), already recorded there; no separate ADR.

### 27. The bodyless 304's `Error: Not Modified` Swagger UI display is accepted as a client-side artifact (ETag/Conditional GET task _056)

- **Context:** the user reported that Swagger UI shows an error for the
  bodyless `304` response while Postman/curl behave correctly, and asked
  whether it can be removed. Live reproduction against the dev server
  (Try it out → `If-None-Match` → 304) captured the exact display
  (`Error: Not Modified` under the response code) and the mechanism: the
  installed swagger-client (bundled in swagger-ui-dist 5.34.0) throws
  `new Error(statusText)` for every response with `ok === false` — i.e.
  everything outside 200–299, which includes 304 — and the UI surfaces that
  thrown message as the response body when there is no body to render.
- **Decision:** no server-side or spec-side change. The 304 stays genuinely
  bodyless with no `Content-Type` (ADR-038 §5, RFC 9110 §15.4.5, pinned by
  e2e), and the OpenAPI transform's `304` declaration (description + `ETag`
  header, no content) stays as documented. The display is recorded as a
  known Swagger UI artifact in `docs/api.md` instead.
- **Reasoning:** the rendering is keyed off the response status class and
  the empty body, both of which are mandated by the protocol and by the
  accepted ADR; no compliant header or declaration combination can change
  what swagger-client does with a 2xx-class-excluded, bodyless response.
  Sending a body on a 304 is forbidden by RFC 9110, adding a body-describing
  `Content-Type` would contradict both the ADR and the e2e contract, and
  patching the served UI bundle is out of scope for a development-only tool.
- **Alternatives considered:** smuggling a body onto the 304 (rejected —
  protocol violation, browsers may drop it anyway); declaring JSON content
  for the documented 304 (rejected — makes the spec lie, still renders an
  error via failed `JSON.parse("")`); serving a patched swagger-ui bundle
  (rejected — vendor drift for a dev-only cosmetic).
- **Trade-offs:** Swagger UI users see a red-styled `Error: Not Modified`
  for a successful revalidation; documented in `docs/api.md` so the display
  is not mistaken for an API defect.
- **Impact:** none on the API surface; developer-facing documentation only.
- **Reversibility:** trivial — the note can be removed if swagger-ui ever
  changes its empty-response rendering.
- **ADR Recommendation:** None — no code or contract change; a documented
  observation about a third-party development tool's rendering.

### 28. The idempotency scope secret is resolved lazily through the config factory, not ConfigService (_057, ADR-039)

- **Context:** `@Idempotent()` decorator arguments evaluate at
  class-definition time, before any dependency-injection container exists, so
  the challenge endpoint's scope function cannot receive `ConfigService` the
  way services do; the secret still had to come from the validated
  environment.
- **Decision:** `enrollments.idempotency.ts` calls the `IDEMPOTENCY_CONFIG`
  `registerAs` factory directly (`idempotencyConfig().scopeSecret`) on first
  use and caches it, mirroring the existing `serverConfig()` direct-call
  precedent in `main.ts`'s bootstrap.
- **Reasoning:** env validation runs at import time (`_env = validateEnv()`),
  so by the first request the value is validated and fail-fast; a request-time
  lazy read keeps the decorator options a plain, testable object. The
  alternative — reading `_env` directly outside a config factory — would have
  bypassed the config layer.
- **Alternatives considered:** `ConfigService` injection (impossible at
  decoration time); module-level `forRootAsync` options carrying the scope
  (rejected — the scope is challenge-specific, not an application-wide
  default); a mutable holder set during bootstrap (rejected — hidden coupling).
- **Trade-offs:** the secret read bypasses `ConfigService.getOrThrow`, so no
  namespace-token override applies to it — consistent with `serverConfig()`,
  which has the same property.
- **Impact:** `enrollments.idempotency.ts` imports the config factory; the
  spec mocks `env.config` like every other unit spec.
- **Reversibility:** trivial — a provider-backed options factory could replace
  it if decorator evaluation ever changes.
- **ADR Recommendation:** None — the mechanism is recorded in ADR-039's
  decision 3 and flagged for review in the approved proposal.

### 29. The store's Lua scripts are registered as ioredis named custom commands (_057, ADR-039)

- **Context:** the `RedisIdempotencyStore` needs four custom Lua scripts;
  the first draft executed them per call through the client's generic script
  execution method, which the Mimosa pre-tool-use security gate blocked as a
  code-injection pattern.
- **Decision:** the scripts are registered once in the store's constructor
  with `client.defineCommand('idempotencyAcquire'|..., { numberOfKeys: 1,
  lua })` and invoked as named client methods, typed through a
  `declare module 'ioredis'` interface augmentation co-located in the store
  file.
- **Reasoning:** registration is not a gate workaround only — it is the
  documented ioredis mechanism for custom commands: scripts are declared
  statically (nothing dynamic executes per call), ioredis manages the
  EVALSHA/EVAL fallback itself, and the four call sites get exact signatures
  instead of variadic argument arrays.
- **Alternatives considered:** per-call script execution with a renamed
  wrapper (rejected — hides the same pattern from review without changing
  it); adding the four scripts as `RedisService` methods (rejected — spreads
  idempotency logic into the shared Redis module, breaking feature
  ownership); a separate script-load via `SCRIPT LOAD` + `EVALSHA` handling
  (rejected — reimplements what defineCommand already does).
- **Trade-offs:** the shared client gains four `idempotency*` methods
  app-wide (namespaced, collision-free); the module augmentation is global,
  so the type surface is wider than the single consumer.
- **Impact:** `redis-idempotency.store.ts` owns registration and typing;
  the throttler storage's own script is untouched.
- **Reversibility:** trivial — the scripts are plain strings.
- **ADR Recommendation:** None — an implementation mechanism inside ADR-039's
  accepted store decision.

### 30. The e2e tier runs with fileParallelism disabled (_057, ADR-039)

- **Context:** the idempotency e2e scenarios assert exact Redis key state —
  per-tracker throttler counters and per-record idempotency keys — in the ONE
  Redis container the whole tier shares (ADR-025). Parallel test files
  (several of which clean `neo-bank:throttler:*` between tests) raced those
  assertions and produced cross-file flakes during development.
- **Decision:** `test/vitest-e2e.config.ts` sets `fileParallelism: false`,
  so e2e files run sequentially. The redis tier already made the same
  trade-off (it runs one container per file instead).
- **Reasoning:** shared-container key-state assertions cannot be made
  noise-immune against other files' cleanups without giving up the
  per-tracker key derivation, which is the more valuable property (it also
  survives legitimate concurrent traffic). Serialization is the honest fix.
- **Alternatives considered:** delta-based assertions (still racy — another
  file's cleanup lands between the two reads); a dedicated container for the
  idempotency spec (rejected — fragments the ADR-025 "one shared container"
  model and duplicates boot cost); leaving it parallel and hoping
  (rejected — flakes).
- **Trade-offs:** e2e wall time rises (~7 s → ~19 s measured) with no loss of
  coverage; the globalSetup containers still boot once per run.
- **Impact:** documented in the config comment, `PROJECT_CONTEXT.md`, and the
  feature record; no spec changes needed.
- **Reversibility:** trivial — delete the flag if key-state assertions ever
  move to an isolated container.
- **ADR Recommendation:** None — test-infrastructure tuning recorded in the
  config, `PROJECT_CONTEXT.md`, and ADR-039's testing section.

### 31. A replayed stored error keeps the detail localized at original-throw time (_057, ADR-039, code-reviewer CR-01)

- **Context:** `storeIf` stores deterministic business 4xx outcomes, whose
  Problem Details `detail` was localized for the locale of the request that
  produced them. The package replays a stored error by re-throwing its
  stored body, so a retry in a different locale receives the original
  locale's detail string; the reviewer flagged both the code divergence
  (fixed: the body's `ErrorCode` now carries through) and the detail-locale
  question.
- **Decision:** the replayed error's `code`, `type`, and `title` are aligned
  with the original execution (the filter carries the stored `ErrorCode`
  through, and the title still localizes per request); the stored `detail`
  is served as stored — the original-throw locale's text — rather than
  re-localized per retry.
- **Reasoning:** re-localizing details would require a code→detail-key map
  covering every business error plus the exact original i18n arguments — a
  cross-cutting mechanism with real drift risk, for a string that is one
  human-readable sentence inside an otherwise fully aligned response. The
  machine-readable contract (code/type/status/title) is what clients branch
  on.
- **Alternatives considered:** a per-code detail-key registry
  (rejected — duplicates the i18n layer and cannot reconstruct parameterized
  details like validation messages); dropping the stored detail on cross-locale
  replays (rejected — inconsistent response shape); storing pre-localization
  keys instead of rendered strings in stored outcomes (rejected — touches the
  package's storage contract).
- **Trade-offs:** a Persian-locale retry of an English-locale failure sees an
  English detail sentence with a Persian title — bounded, documented
  inconsistency.
- **Impact:** documented here and in `docs/api.md`'s replay section;
  tracked as `judge-findings.md` Wave 28 CR-01's accepted disposition.
- **Reversibility:** moderate — a detail-registry could be added later
  without a format change.
- **ADR Recommendation:** None — a bounded i18n nuance of ADR-039's accepted
  storeIf decision; revisit only if cross-locale replays become a product
  concern.

### 32. Phase 0 documentation strategy for superseding the phone-uniqueness rejection (_058, Enrollment master prompt Phase 0)

- **Context:** the Enrollment master prompt's Phase 0 (documentation-only)
  required superseding the 2026-11-16 developer rejection of phone-number
  uniqueness with the new one-non-expired-Enrollment-per-phone invariant.
  The rejection was recorded in two durable places (`DEFERRED.md` entry 1 of
  the _051 section, bundled with three still-open decisions;
  `docs/judge-findings.md` Wave 21 SEC-02), and the master prompt expected
  `docs/security-otp-enrollment.md` to still present the rejected decision —
  it does not.
- **Decision:** supersession is recorded inline as dated annotations
  (strikethrough + supersession note in `DEFERRED.md`; a dated supersession
  bullet in SEC-02), never by rewriting or deleting the historical text;
  `docs/security-otp-enrollment.md` was left untouched because it contains
  no phone-uniqueness statements (verified by search); no ADR was written
  for the invariant in Phase 0 — the ADR proposal is scheduled for the phase
  that lands the partial unique index migration (Phase 2), where the
  ADR-first workflow already applies.
- **Reasoning:** the registry's own convention ("Do not delete items — mark
  them Done with a reference") and findings-tracker integrity both demand
  traceable, dated annotations over silent rewrites; a Phase 0 ADR would
  duplicate the master prompt's developer decision before the implementation
  details (index DDL, legacy-data backfill) it must record exist.
- **Alternatives considered:** deleting the rejection sentence (rejected —
  destroys traceability); marking the whole `DEFERRED.md` entry "Won't Do"
  (rejected — three of its four decisions are still open); writing the ADR
  now with placeholder implementation details (rejected — speculative).
- **Trade-offs:** readers hit the struck-through rejection before the
  supersession note in `DEFERRED.md`; acceptable — the note names the new
  rule and its enforcement path.
- **Impact:** root `AGENTS.md` gained the "Neo Bank Business Domain" section
  and the "Strict Database Constraint Discipline" subsection;
  `apps/api/AGENTS.md` references the discipline; `DEFERRED.md` and
  `docs/judge-findings.md` carry dated supersessions;
  `docs/current-state.md`/`docs/architecture.md` needed no change (they
  assert no uniqueness position).
- **Reversibility:** trivial — the annotations are additive.
- **ADR Recommendation:** ADR candidate for Phase 2 (partial unique index +
  legacy-data backfill strategy), not for Phase 0.

### 33. PostgreSQL 18 upgrade execution adaptations (_059, ADR-040, Enrollment Phase 1)

- **Context:** ADR-040's approved procedure said "rename the old volume" and
  change pins. Execution found two realities: `docker volume rename` does
  not exist as a Docker CLI command, and the PostgreSQL 18+ official images
  refuse to start with a mount at the legacy `/var/lib/postgresql/data`
  (they require the parent `/var/lib/postgresql` and store data in
  major-version subdirectories — docker-library/postgres#1259).
- **Decision:** the old volume was preserved by a byte-verified `tar` copy
  into an archive volume (1277 files, 48,321,376 bytes, exact parity) before
  the original volume was removed and a fresh one created under the
  Compose-managed name; the Compose mount points (dev and prod) moved to
  `/var/lib/postgresql`; ADR-040 Decision 1 was amended inline to record the
  image-layout requirement; the restore drops the auto-initialized
  application database before replaying the `pg_dumpall` archive.
- **Reasoning:** the archive copy preserves the ADR's invariant (old data
  kept, nothing deleted before a verified backup exists) through the only
  mechanism the CLI offers; the mount-point move has no alternative path —
  the image hard-errors on the legacy mount — so applying it during
  implementation with an ADR amendment and a developer-visible flag honors
  both the approved decision and the amendment workflow.
- **Alternatives considered:** renaming the Compose volume to a new name
  (rejected — leaves the active volume name holding stale PG 17 data and
  diverges dev/prod naming); `PGDATA` env override to keep the legacy mount
  (rejected — fights the image's supported layout and blocks the
  `pg_upgrade --link` capability the new layout exists to enable); `pg_upgrade`
  (already rejected in ADR-040).
- **Trade-offs:** one extra copy step per environment; the archive volume
  and dump file occupy host space until the developer approves disposal.
- **Impact:** `docker/compose.app.dev.yml`, `docker/compose.app.prod.yml`
  (mounts + comments), ADR-040 Decision 1; captured for reuse in the prod
  procedure.
- **Reversibility:** full — mount the archive volume at the legacy path with
  the 17.6 image (or copy back) and revert the pins.
- **ADR Recommendation:** None beyond the applied ADR-040 amendment — the
  layout requirement is an image/platform fact, recorded where it was
  discovered.
