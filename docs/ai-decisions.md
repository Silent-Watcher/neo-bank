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
