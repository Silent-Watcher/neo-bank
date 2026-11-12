# 038 — E2E Testcontainers (ADR-025)

## Original User Request

Task 1 of the four-task master prompt: extend the existing Testcontainers
approach so the external service required by the e2e tests is also managed
automatically — no manually started Docker containers, no manual Docker
commands; running the e2e test command must start the needed infrastructure,
execute the tests, and clean everything up. Preferred lifecycle: one shared
container per e2e test execution (evaluated against the alternatives, not
implemented blindly). Existing Redis Testcontainers functionality must not be
replaced, and no additional containers may be introduced for unrelated suites.

## Implementation

- **ADR-025** ("Manage the E2E Redis with Testcontainers") written to
  `DECISIONS.md` as the first repository write; documents the per-run shared
  container decision, the evaluated lifecycle alternatives, and the
  dependency cleanup (developer later re-confirmed the removal of the two
  never-imported `@testcontainers/*` wrapper packages after initially
  questioning it).
- **`apps/api/test/e2e.global-setup.ts`** (new): Vitest globalSetup — starts
  ONE shared `TestRedis` container per test execution via the unchanged
  `startTestRedis()` helper (`redis:8.2-alpine`, dynamic mapped port,
  `REDIS_PASSWORD`, log wait strategy), provides the `RedisConfig` to all
  workers through Vitest's native `provide`/`inject` channel (typed via a
  `ProvidedContext` module augmentation), and returns the teardown that stops
  the container (ryuk reaps orphans after a crash).
- **`apps/api/test/vitest-e2e.config.ts`**: `globalSetup` wired via an
  absolute `fileURLToPath` path (cwd-independent).
- **`apps/api/test/create-test-app.ts`**: `CreateTestAppOptions.redisConfig`;
  builds the client with the existing `createRedisClient` and overrides the
  `REDIS_CLIENT` provider; new `createE2eTestApp()` wrapper injects the
  provided container config. All 14 `*.e2e-spec.ts` files renamed
  `createTestApp` → `createE2eTestApp` (mechanical); `test:redis` specs
  untouched.
- **`apps/api/env/.env.test`**: REDIS_* values are documented validation-only
  placeholders (schema requires them at import; the connection comes
  exclusively from the container).
- **`apps/api/package.json`**: removed never-imported devDeps
  `@testcontainers/redis` + `@testcontainers/postgresql`; core
  `testcontainers` ^12.2.1 retained (lockfile synced).
- **Enrollments e2e spec**: its key-cleanup client now also uses the injected
  container config instead of `_env.REDIS_URL` (the last env-Redis coupling).
- **Documentation** (documentation-writer): apps/api/AGENTS.md, ONBOARDING.md,
  docs/current-state.md, README.md, PROJECT_CONTEXT.md — plus the approved
  drift fixes (stale ADR range, "Pending ADRs" claim, phantom root
  `pnpm test:redis`, stale compose/env paths in ADR-020/022 References,
  removal of the missing `learning-guide.fa.md` reference).
- **Drift cleanups**: `test/vitest-redis.config.ts` stale "share one Redis
  server" comment corrected to the actual per-file container model; orphan
  `docker/env/.env.docker` (byte-identical duplicate of `.env.docker.dev`)
  deleted after verification.

## Decisions

- **One shared container per e2e run** (the user's stated default, confirmed
  by evaluation): 14× per-file containers buy isolation the HTTP-contract e2e
  specs do not need, and the suite already shared one Redis server before.
  Fresh container per run also eliminates cross-run key leakage — strictly
  more reproducible than the long-lived compose Redis.
- **`REDIS_CLIENT` override, not `REDIS_CONFIG`** (validation-driven):
  `@nestjs/config`'s `ConfigService` holds the `registerAs` factory result and
  does not observe provider overrides on the namespace token — proven by the
  first validation run (app dialed the env URL; 31 failures). The client is
  now supplied directly via `createRedisClient(config)`, the exact mechanism
  the `test:redis` tier has always used; `RedisService` still owns the
  connection lifecycle.
- **Explicit `createE2eTestApp` wrapper** instead of suite-detection magic:
  the `test:redis` suite runs under a config without globalSetup, where
  `inject()` would throw; a wrapper keeps the contract typed and explicit
  (logged in `docs/ai-decisions.md`).
- **Dependency removal re-confirmed by the developer**: the wrappers had zero
  imports; core `testcontainers` covers both suites; the Postgres wrapper can
  be re-added when a database integration actually lands.

## Validation (delegated subagent reports)

- **Final e2e independence proof**: `REDIS_URL=redis://127.0.0.1:59999
  REDIS_PASSWORD=x pnpm test:e2e` → **14/14 files, 77/77 tests passed, exit
  0**; zero occurrences of the dead endpoint in the output (nothing dialed
  the env Redis). The developer's requirement — no manual containers, no
  manual startup — is met and proven, not assumed.
- **Container lifecycle**: container starts once per run; teardown verified;
  `docker ps -a` shows no testcontainers containers after runs (checked
  immediately and ~90 s later).
- **`pnpm test:redis`** (untouched suite): 4 files / 60 tests pass.
- **Unit suite**: 285/285 pass. **`pnpm typecheck`**: 3/3 pass.
  **`pnpm lint`**: 0 errors, 42 warnings — the same pre-existing set, none
  introduced by this change. **`pnpm format:check`**: clean.
- **Honest failure history**: validation attempt 1 failed (REDIS_CONFIG
  override ineffective — root-caused and fixed); attempt 2 failed for one
  spec file (its own cleanup client still dialed the env Redis — fixed);
  attempt 3 failed on my incomplete edit (removed `_env` import still used
  for the HMAC digest secret — import restored); attempt 4 fully green. All
  four runs reported with real outputs.

## Notes

- e2e now runs against `redis:8.2-alpine` (TestRedis) instead of the dev
  stack's `redis-stack` image; the API uses only core Redis commands, and the
  redis tier has always validated against the same image.
- `pnpm test:e2e` requires a running Docker daemon (previously optional for
  it; already required for `test:redis`).
- One pre-existing oddity was flagged by validation and left untouched (out
  of scope): `enrollments.e2e-spec.ts` line ~74 `.useValue(configureModule ?
  undefined : undefined)` — both branches identical.
- Not committed; awaiting explicit approval.
