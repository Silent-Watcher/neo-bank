# 039 — Memory-Based Load Shedding and Health-Aware Readiness (ADR-026)

## Original User Request

Task 3 of the four-task master prompt: investigate and implement a mechanism
that protects the API when memory consumption becomes dangerously high —
activation threshold, temporary protection state, 503 + Retry-After for new
requests, orchestrator-detectable unavailability, automatic recovery — with an
explicit architectural investigation and approval before implementation (the
11-item proposal was presented and approved; ADR-026 written first).

## Implementation

- **ADR-026** ("Memory-Based Load Shedding and Health-Aware Readiness")
  written to `DECISIONS.md` as the first repository write: RSS-driven
  sampling, hysteresis state machine, global admission guard, readiness/
  liveness split, no-dependency design.
- **`src/shared/memory-protection/`** (new module):
  - `MemoryProtectionService` — samples `process.memoryUsage().rss` on
    `MEMORY_PROTECTION_SAMPLE_INTERVAL_MS` (immediate first sample at
    bootstrap; `unref`'d interval; cleared on shutdown); activates on one
    sample ≥ MAX_RSS_MB, recovers after STABLE_SAMPLES consecutive samples
    below RECOVERY_RSS_MB (streak resets on any sample at/above recovery);
    transitions logged warn/log via the Pino-backed Nest logger.
  - `MemoryProtectionGuard` — global `APP_GUARD` registered **before**
    `RedisThrottlerGuard` (cheapest rejection, no Redis on the rejection
    path); while protected, non-exempt requests get 503 Problem Details
    (localized detail at the throw site) + `Retry-After` = seconds to the
    next sample; exemptions via `@SkipMemoryProtection()` metadata.
  - `MemoryHealthIndicator` — Terminus indicator: down while protected.
  - `MemoryProtectionModule` (@Global, mirrors RedisModule; provides the
    config token locally — see `docs/ai-decisions.md` §3).
- **Readiness endpoint** `GET /health/ready`: version-neutral, prefix-excluded
  (`main.ts` + `create-test-app.ts`), unthrottled, shedding-exempt; Terminus
  over strict-Redis (`RedisHealthIndicator.checkReady()` — down on ping
  failure) + memory indicator → 503 when any is down; failed checks are
  rethrown as bare `ServiceUnavailableException` with localized detail so the
  Problem Details contract stays bilingual. `GET /health` is byte-identical to
  before (liveness; Compose healthcheck semantics preserved).
- **Error contract**: `ErrorCode.ServiceUnavailable` added (503 status
  mapping, application-error Problem Type, static title; title localization
  falls back to the existing `errors.status.serviceUnavailable` in both
  catalogs — BadRequest/NotFound precedent).
- **Filter logging**: bare 5xx exceptions without an attached error (deliberate
  rejections) now log at warn (`HTTP <status> <code>`); only exceptions with an
  attached error log at error level (judge CR-04 — keeps incident logs clean).
- **Env**: new `MEMORY_PROTECTION_*` namespace (Zod schema + `registerAs`
  symbol token; SAMPLE_INTERVAL_MS bounded at 1 hour — Node clamps larger
  timer delays to 1 ms); cross-field rule RECOVERY < MAX in the aggregate
  superRefine; populated in `.env.example`/`.env.development`/`.env.production`
  (defaults 1024/768/5000/3/enabled); `.env.test` + `.env.redis-test` set
  `ENABLED=false` for suite determinism (behavior covered via DI overrides).
- **i18n**: `errors.details.serviceOverloaded` and `health.memoryProtected` /
  `health.notReady` added in en + fa (approved Persian wording, Option A).
- **Docs** (documentation-writer): apps/api/AGENTS.md (shared-module list +
  global guard-order convention), apps/api/ONBOARDING.md (env table, module
  structure, routes), docs/current-state.md (behavior bullets + ADR-026 +
  test counts), PROJECT_CONTEXT.md (core-contract bullet + ADR index).

## Decisions

- **Guard + readiness combined** (approved design): readiness alone cannot
  stop direct traffic; the guard covers non-orchestrated environments and
  control-plane lag; `/health` deliberately excludes the memory indicator so
  no orchestrator restarts a pressured process.
- **Config-token DI pattern**: local provider for the `registerAs` token in
  the owning module (logged in `docs/ai-decisions.md` §3; second discovery of
  the `ConfigService`-ignores-overrides trap this session).
- **Interval bound (CR-02)**: schema-level max (1 hour) instead of accepting
  values Node would silently clamp to 1 ms.
- **Warn-level logging for deliberate 503s (CR-04)**: root-caused in the
  shared filter — error level now requires an attached error.

## Validation (delegated subagent reports; final state)

- Unit: **34 files / 318 tests pass** — including memory-protection env (13),
  service (8: activation/recovery/hysteresis/shutdown/retry-hint/disabled),
  guard (3), indicator (2), rewritten health.controller.spec (5), extended
  redis.health.spec (checkReady), error.code.spec (503), problem-details
  filter spec (incl. bare-503 warn case). i18n catalog-consistency 4/4.
- E2E: **15 files / 83 tests pass** — incl. new memory-protection.e2e-spec
  (forced protection via config override: non-exempt 503 + `Retry-After: 60`
  - `SERVICE_UNAVAILABLE` + application-error type + localized detail;
    `/health` 200 while protected; `/health/ready` 503; docs page 200) and new
    readiness cases in redis-health.e2e-spec.
- `pnpm typecheck` 3/3; `pnpm lint` 0 errors (41 warnings, all pre-existing
  classes in pre-existing files — zero in the new/changed feature files);
  `pnpm format:check` clean.
- Env name-set parity: `.env.example` = `.env.development` = `.env.production`
  (32 names each, verified identical).
- **Honest failure history**: validation round 1 found 3 defects (Logger.info
  does not exist; eager `_env` import killed the 3 new unit specs; missing
  config-token provider broke all e2e) — fixed; round 2 found a guard-spec
  wiring bug (`{} as Reflector`) and a stale swagger route list — fixed; the
  final round was fully green. All rounds reported with real outputs.

## Notes

- Review gates: code review APPROVED_WITH_SUGGESTIONS (4 suggestions) → all
  fixed → re-review and security verdicts recorded in
  `docs/judge-findings.md` (Waves 11–12).
- Production thresholds (1024/768 MB) are defaults, not measurements: tune
  MAX_RSS_MB to the real deployment memory limit per the ADR's operational
  implications.
- Redis integration tier untouched (`pnpm test:redis`: 4 files / 60 tests,
  verified green in the Task 1 validation and unaffected since).
- Not committed; awaiting explicit approval.
