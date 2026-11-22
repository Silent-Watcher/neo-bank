# _062 — Enrollment State Machine and Lazy Expiration (Enrollment Master Prompt Phase 4)

## Original Request

Phase 4 of the Enrollment master prompt: implement the central state machine
per §10 (`enrollment-state-machine.service.ts` — @Injectable, no database,
no Redis, no independent clock, `now: Date` received explicitly, only
mutates the passed entity, transaction ownership left to the caller), the
legal status transition table with one private `transitionTo()`, the step
guards (§10.4), `expireIfDue()` and `executeStep()` (§10.3), completion
semantics (§10.5), expiration persisted before any HTTP 410 (§11.1),
optimistic locking through the inherited `version` (§11.2), and table-driven
unit tests plus deterministic PostgreSQL integration tests. No background
job. The developer additionally directed: fix the recurring stray snapshot
first, implement related deferred items, persist every out-of-scope
security recommendation, and wait for final approval before committing.

## Approval Gate

No new ADR: every design decision in this phase is prescribed verbatim by
the master prompt (§10.1–§10.5, §11.1–§11.2), which the developer supplied
and approved — the implementation introduces no open architectural choice.
The pre-commit approval remains with the developer (standing per-phase
rule).

## Pre-Phase Fix (developer-directed)

**Stray snapshot root-caused and fixed** (commit `f11494b`): the
migration-parity spec's `Migrator` had no migrations path configured, so
`migrator.up()` wrote `.snapshot-<db>` relative to the CWD on every db-tier
run (`apps/api/.snapshot-neo_bank.json`, verified against `Migrator.js`
snapshot gating). `snapshot: false` set on the replay; the stray no longer
regenerates (verified by a full db-tier run after deletion).

## Implementation

- **`enrollment-state-machine.service.ts`** — `EnrollmentStateMachine`
  (@Injectable, registered in `EnrollmentsModule`): exports the legal
  transition table `ENROLLMENT_LEGAL_TRANSITIONS` (single source,
  table-tested); `expireIfDue()` expires `INITIAL`/`IN_PROGRESS` at
  `expiresAt <= now` through the central `transitionTo()`; `executeStep()`
  runs the guards (due expiration first — the transition applies to the
  entity before the rejection throws; step-receptive statuses are exactly
  the expirable ones; `COMPLETED` never submittable; future steps rejected
  before predecessors), invokes `apply()` only after all guards pass, and
  resolves the next state (first submission `INITIAL`→`IN_PROGRESS`;
  current-step submission advances `currentStep`; completing
  `VIDEO_VERIFICATION` sets `currentStep = COMPLETED` and transitions to
  `PENDING_REVIEW` per §10.5; earlier-step edits apply without moving the
  marker). An illegal internal transition is a programming error (plain
  `Error`, never client-mapped). The transition table and step positions
  derive from the single-source enums.
- **`enrollment-state-machine.error.ts`** — pure-domain rejection type
  carrying `ErrorCode`, the i18n detail key, and the intended HTTP status;
  no HTTP/i18n dependency in the machine itself. The request-scoped caller
  maps it after persisting any pending expiration (§11.1 contract,
  documented on the class).
- **Error contract** — `ErrorCode.EnrollmentExpired` (410 Gone) and
  `ErrorCode.EnrollmentStepNotAllowed` (409 Conflict) added to the
  problem-type/title/title-key maps; bilingual catalogs: new
  `src/i18n/{en,fa}/enrollment.json` detail keys (`enrollment.expired`,
  `enrollment.stepNotAllowed`) + titles in both `errors.json` catalogs.
  Catalog-consistency tests pass.
- **Unit tests** (`enrollment-state-machine.spec.ts`, 25 table-driven
  cases): the exact legal transition table; `expireIfDue` across
  before/at/after the instant × every expirable status × every
  non-expirable status × an already-expired record; the full-form
  walkthrough (8 submissions → `PENDING_REVIEW`/`COMPLETED`); future-step
  rejection without `apply()`; earlier-step edits; `COMPLETED` rejection;
  every non-receptive status; expiration inside `executeStep` (transition
  applied before the rejection, one-millisecond-before acceptance); the
  domain rejection shape (code/detailKey/410/409).
- **Integration tests** (`enrollment.db-spec.ts`): lazy expiration
  persisted before the rejection surfaces (§11.1 — flush proves the
  exception never rolled the transition back), phone release after lazy
  expiry, and optimistic locking through the machine (two forks; stale
  version → `mapOptimisticLockError` → `AppHttpException`
  `VersionConflict`, §11.2).

## Key Decisions

- **Pure-domain rejection type instead of throwing `AppHttpException`
  directly:** the machine has no request scope, so it cannot localize
  details; it carries `ErrorCode` + detail key + status, and the Phase 6
  caller performs the localized mapping after persisting the expiration.
  Keeps the machine free of HTTP/i18n dependencies (master prompt §10).
- **The step-receptive statuses are the expirable ones** (`INITIAL`/
  `IN_PROGRESS`): one `Set` serves both guards with a comment pinning the
  identity — the incomplete lifecycle states neither expire-without-modify
  nor receive steps once complete.
- **No ADR:** master prompt §10/§11 prescribes the full design; no open
  decision existed (recorded here; the pre-commit approval stays with the
  developer).
- **v7/MikroORM details:** `EXPIRABLE_ENROLLMENT_STATUSES.includes()`
  cannot narrow `Opt<T>` — the membership check uses a
  `Set<EnrollmentStatus>`; `transitionTo` narrows the status read before
  indexing the transition table.

## Validation (all executed, 2026-11-22)

- typecheck clean; unit 55 files / 530 tests (25 new state-machine cases);
  db 6 files / 53 tests (lazy-expiration persistence + release +
  optimistic-lock mapping); e2e 115; redis 89 — all four tiers green on the
  full turbo run. Counts reflect the post-remediation suite (Wave 35
  iteration 2: the catalog-validation and boundary fixes added two cases).
- No migration created in this phase (no schema change) — the
  migration-reviewer was not required.
- Bilingual catalogs verified by the catalog-consistency tests (en/fa key
  parity for the two new detail keys and titles).
- Review gates: code review CHANGES_REQUIRED → remediated →
  APPROVED_WITH_SUGGESTIONS (Wave 35, iteration 2: CR-01 i18n namespace
  registration + typed detail keys was the blocker; CR-02 corrupt-hydration
  case, CR-03 boundary fixture, CR-04 assertion hygiene, CR-05
  throwing-apply atomicity, CR-06 record counts all resolved); code
  security SECURITY_APPROVED_WITH_INFORMATIONAL_FINDINGS (Wave 36 — three
  informational, forward-looking findings: SEC-01/SEC-02 persisted to
  `DEFERRED.md` _062 entries 1–2 per the developer's standing rule; SEC-03
  corrupt-state hardening applied in-component with a dedicated unit case).
  All four tiers re-verified green after every remediation wave.
- Recurring-annoyance fix landed first (`f11494b`): the parity replay no
  longer writes the stray `apps/api/.snapshot-neo_bank.json`.

## Deferred

- Phase 6 contract hazards from the security gate (`DEFERRED.md` _062
  entries 1–2, Wave 36 SEC-01/SEC-02): challenger authentication before
  state-error mapping, persist-in-the-same-fork discipline, and the
  expired-condition status-split decision.
- The localized HTTP mapping of `EnrollmentStateMachineError` (410/409
  Problem Details) lands with the Phase 6 step-submission endpoints, where
  the request scope exists.
- Background expiration job — deferred by the master prompt (§13.4); the
  machine's `expireIfDue` is the mechanism-independent core it will reuse.
- Security recommendations from this phase's gates that fall outside
  Phase 4 scope are persisted in `DEFERRED.md` and tracked in
  `docs/judge-findings.md` (see the phase gates in the final report).
- Phase 5 (OTP verification persistence), Phase 6 (step submission APIs)
  await explicit developer instruction.
