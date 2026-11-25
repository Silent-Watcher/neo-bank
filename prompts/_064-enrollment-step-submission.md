# _064 — Enrollment Step Submission APIs (Phase 6)

**Date:** 2026-11-24
**Branch:** feature/enrollments
**Status:** Complete — ready for review gates

---

## Summary

Implemented the eight user-facing step submission endpoints for the Enrollment
onboarding form, completing Phase 6 of the master prompt. The endpoints allow
a customer (who has verified their phone via OTP) to submit each form step
in sequence, with strict state machine guards, lazy expiration, optimistic
locking, and bilingual responses.

---

## Files Created

### 1. `src/modules/enrollments/enrollments.steps.schema.ts`

Zod validation schemas for all 8 submittable steps, with bilingual i18n messages:

| Step                 | Fields                    | Key Validations                                                                                                                                          |
| -------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NATIONAL_CODE`      | `nationalCode`            | 10 digits (derives pattern from `ENROLLMENT_NATIONAL_CODE_FORMAT`)                                                                                       |
| `FULL_NAME`          | `firstName`, `lastName`   | Each ≤ 50 chars                                                                                                                                          |
| `BIRTH_DATE`         | `birthDate`               | ISO date `YYYY-MM-DD`                                                                                                                                    |
| `REFERRAL_CODE`      | `referralCode` (optional) | ≤ 20 chars                                                                                                                                               |
| `USERNAME`           | `username`                | 3–30 chars, alphanumeric + `._-` (case-insensitive input, normalized to lowercase via `.transform()`; derives pattern from `ENROLLMENT_USERNAME_FORMAT`) |
| `PASSWORD`           | `password`                | 8–128 chars, at least one letter + one digit                                                                                                             |
| `OCCUPATION`         | `occupation`              | ≤ 100 chars                                                                                                                                              |
| `VIDEO_VERIFICATION` | (empty)                   | Strict empty body (`.strict()`)                                                                                                                          |

All schemas reference the single-source constants from `enrollments.enums.ts`
(DEFERRED _061 #1 resolved).

### 2. Updated `src/modules/enrollments/enrollments.service.ts`

- **`submitStep(publicId, step, now, apply)`** — core orchestration:
  1. Loads enrollment by `publicId` with `LockMode.PESSIMISTIC_WRITE`.
  2. Runs `stateMachine.expireIfDue()`; if due, persists `EXPIRED` transition
     **before** throwing `ENROLLMENT_EXPIRED` (410) — master prompt §11.1.
  3. Executes step via `EnrollmentStateMachine.executeStep()` (guards + apply).
  4. Flushes with optimistic locking; `mapOptimisticLockError` → `VersionConflict` (409).
  5. Maps unique constraint violations:
     - `national_code` → indistinguishable `ENROLLMENT_STEP_NOT_ALLOWED` (CWE-204 privacy, DEFERRED _061 #5 / SEC-04).
     - `username` → `usernameTaken` disclosure (standard UX).
  6. Returns `{ publicId, status, currentStep, expiresAt }` (wrapped in success envelope).
- **`hashPassword(password)`** — Argon2id (memory 19456 KiB, time cost 2, parallelism 1); plaintext never stored.

### 3. Updated `src/modules/enrollments/enrollments.controller.ts`

Eight `POST /api/v1/enrollments/:publicId/step/:step-name` endpoints:

| Endpoint                   | Rate Limit | Next Step on Success                 |
| -------------------------- | ---------- | ------------------------------------ |
| `/step/national-code`      | 20/120s    | `FULL_NAME` (status → `IN_PROGRESS`) |
| `/step/full-name`          | 20/120s    | `BIRTH_DATE`                         |
| `/step/birth-date`         | 20/120s    | `REFERRAL_CODE`                      |
| `/step/referral-code`      | 20/120s    | `USERNAME`                           |
| `/step/username`           | 20/120s    | `PASSWORD`                           |
| `/step/password`           | 20/120s    | `OCCUPATION`                         |
| `/step/occupation`         | 20/120s    | `VIDEO_VERIFICATION`                 |
| `/step/video-verification` | 20/120s    | `COMPLETED` + `PENDING_REVIEW`       |

Each endpoint: Zod validation → `submitStep()` → success envelope with localized message.

### 4. Updated `src/modules/enrollments/enrollment-state-machine.service.ts`

- **`executeStep()`** now explicitly checks for already-`EXPIRED` status after
  `expireIfDue()` and throws `EnrollmentExpired` (410) for both the just-expired
  and already-expired paths (SEC-02 resolved: single 410 contract for expired).

### 5. Updated Entity & Migration

- **`enrollment.entity.ts`**: Added `password_hash` CHECK constraint
  `enrollments_password_hash_length` (`char_length(password_hash) <= 72`)
  — defense-in-depth bound (SEC-03 resolved, DEFERRED _061 #3).
- **`Migration20261124182507.ts`**: Adds the CHECK constraint via `ALTER TABLE`.

### 6. Bilingual i18n Updates

- `src/i18n/en/validation.json` + `fa/validation.json`: All step field messages.
- `src/i18n/en/enrollment.json` + `fa/enrollment.json`: `stepSubmitted`,
  `enrollmentNotFound`, `usernameTaken` (removed unused `nationalCodeTaken`
  per indistinguishable error decision).

---

## Tests Added

- `enrollments.steps.schema.spec.ts`: 24 tests covering all 8 schemas,
  boundary values, single-source pattern derivation.
- `enrollments.service.spec.ts` (new `submitStep` suite): 19 tests covering
  successful submissions, earlier-step edits, expiration (410 for due + already),
  step-order rejections, unique constraint mappings, optimistic locking,
  not-found.

All unit tests pass (553 total), typecheck clean, oxlint 0 errors.

---

## Security Findings (from code-reviewer & code-security-analyzer)

### Resolved in this phase

- **CR-01 / SEC-02**: Expired enrollment now returns 410 for both due-but-unpersisted
  and already-EXPIRED paths (unified in `executeStep()`).
- **CR-02**: Username schema now accepts uppercase via `.transform(v => v.toLowerCase())`
  before regex; controller normalization removed.
- **CR-03**: `videoVerificationStepSchema` uses `.strict()` to reject extra fields.
- **CR-05**: Unused `nationalCodeTaken` i18n keys removed.
- **SEC-03**: `password_hash` CHECK constraint added (72-char bound).

### Deferred (explicitly mandated by master prompt)

- **SEC-01 (HIGH) — BOLA**: Step endpoints use `publicId` without authorization.
  Documented in DEFERRED.md; fix is Phase 7+ auth guard.
- **SEC-04 (LOW) — Username enumeration**: Distinct "username taken" error.
  Accepted UX trade-off per DEFERRED.md.
- **SEC-05 (LOW) — Generous step rate limit**: 20/120s allows full form completion.
  Primary defense is OTP limits; step limit is secondary DoS guard.
- **SEC-06 (LOW) — No idempotency on step endpoints**: State machine partially
  mitigates (earlier-step edits re-apply without advancing).

---

## Documentation Updates

- `docs/current-state.md`: Added Phase 6 section under "Feature module `enrollments`".
- `DEFERRED.md`: Added Phase 6 section documenting BOLA exposure, resolved items.
- `prompts/_064-enrollment-step-submission.md`: This record.

---

## Migration

- `Migration20261124182507.ts`: Adds `enrollments_password_hash_length` CHECK
  constraint. Reviewed by migration-reviewer (pending).

---

## Verification Checklist

- [x] All 8 step endpoints implemented with correct order and transitions
- [x] Zod schemas derive patterns from single-source enums (DEFERRED _061 #1)
- [x] Bilingual i18n messages for all new user-facing strings
- [x] Lazy expiration persisted before 410 (master prompt §11.1)
- [x] Pessimistic locking + optimistic locking on submitStep
- [x] Unique constraint mapping: national_code indistinguishable, username taken
- [x] Password hashed with Argon2id (OWASP minimum), never stored plaintext
- [x] Username normalized to lowercase before persistence
- [x] Response DTO exposes only publicId, status, currentStep, expiresAt
- [x] Unit tests: schemas (24), service submitStep (19), state machine (26)
- [x] Typecheck: clean
- [x] Lint: 0 errors
- [x] All 553 unit tests pass

---

## Remaining Work (Post-Phase 6)

1. **Migration review** — run migration-reviewer on `Migration20261124182507.ts`.
2. **DB integration tests** — Testcontainers scenarios for step persistence,
   unique constraint violations, expiration race, optimistic lock conflicts.
3. **E2E tests** — full form completion flow, error paths, rate limiting.
4. **Code review gate** — apply any remaining CR findings.
5. **Security gate** — acknowledge deferred findings (BOLA, username enumeration).
6. **Prompt record commit** — include in feature commit when approved.
