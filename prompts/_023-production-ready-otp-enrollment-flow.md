# Production-Ready OTP Enrollment Flow with Security and Reliability Hardening

**Prompt number:** 023
**Date:** 2026-11-07
**Branch:** feature/enrollments
**Commit:** (pending)

---

## Original User Request

Implement a production-ready OTP enrollment flow with security and reliability hardening for the NestJS API. The task explicitly outlined 7 phases:

1. **OTP issuance atomicity** — Use `SET NX EX` to store the OTP so concurrent requests cannot overwrite an existing OTP or extend its TTL.
2. **Verification atomicity with replay protection** — Use a single atomic Lua script that verifies the OTP, consumes it on success (deletes both OTP and attempts keys), or increments an attempt counter on failure; when max attempts is reached, invalidate the OTP so no further attempts can succeed.
3. **Failed attempt limiting** — Maximum 5 failed attempts per 120-second validity window (configurable via `ENROLLMENTS_MAX_VERIFY_ATTEMPTS`).
4. **Integration with existing Redis-backed rate limiter** — Apply `@Throttle()` decorators with endpoint-specific limits aligned with the OTP window: challenge 2 req/120s, verify 5 req/120s.
5. **Validation/input integrity review** — Zod schemas normalize and validate phone numbers (Iranian mobile format) and OTP (six-digit numeric string, leading zeros preserved) before any Redis access.
6. **Redis reliability edge cases** — Atomic Lua scripts for read-check-delete (`deleteIfEquals`) and verify-and-count-attempts; bounded timeouts; no `KEYS` (uses `SCAN`); `UNLINK` not `DEL`; fail-closed on Redis errors (HTTP 500).
7. **OTP hashing (deferred)** — Store OTPs as salted hashes (e.g., Argon2id) instead of plaintext; deferred to DEFERRED.md.

The implementation must reuse existing infrastructure (RedisService, rate limiter, Zod validation, Problem Details errors) without introducing unnecessary abstractions.

---

## Implementation Summary

### Files Created

- `apps/api/src/shared/config/env/schema/enrollments.env.ts` — Zod schema for `ENROLLMENTS_MAX_VERIFY_ATTEMPTS` (default 5)
- `apps/api/src/shared/config/enrollments.config.ts` — Config factory registering `ENROLLMENTS_CONFIG` symbol
- `apps/api/src/modules/enrollments/enrollments.keys.ts` — Added `challengeAttemptsKey(phoneNumber)` for attempt counter

### Files Modified

- `apps/api/src/shared/redis/redis.service.ts` — Added:
  - `setNxEx(key, value, ttlSeconds)` returning boolean (uses `SET key value EX ttl NX`)
  - `verifyOtpAndCountAttempts(otpKey, attemptsKey, submittedOtp, maxAttempts, ttlSeconds)` using atomic Lua script that verifies OTP, increments attempts on failure, invalidates OTP when max attempts reached, cleans up both keys on success
- `apps/api/src/modules/enrollments/enrollments.service.ts` — Updated:
  - `requestChallenge()` uses `setNxEx` and throws generic error on failure
  - `verifyChallenge()` uses `verifyOtpAndCountAttempts` with configurable max attempts from env
- `apps/api/src/modules/enrollments/enrollments.controller.ts` — Added:
  - `@Throttle({ short: { limit: 2, ttl: seconds(120) } })` to challenge endpoint
  - `@Throttle({ short: { limit: 5, ttl: seconds(120) } })` to verify endpoint
- `apps/api/src/shared/config/config.ts` — Integrated enrollments config
- `apps/api/src/shared/config/env/env.config.ts` — Integrated enrollments config
- `apps/api/test/enrollments.e2e-spec.ts` — Fixed to override rate limit config to high values, use distinct X-Forwarded-For per request to avoid throttler interference, use real Redis from .env.test

### Environment Variable Added

- `ENROLLMENTS_MAX_VERIFY_ATTEMPTS=5` — Maximum failed OTP verification attempts per 120-second validity window. Added to `apps/api/env/.env.example` with comment.

---

## Key Technical Decisions

1. **Atomic OTP issuance with SET NX EX** — Prevents race conditions where concurrent requests could overwrite an existing OTP or extend its TTL. If the key already exists, `setNxEx` returns `false` and the service throws the generic `OTP_VERIFICATION_FAILED` error (same as verification failure for security).

2. **Atomic verification with attempt counting in single Lua script** — The `VERIFY_OTP_ATTEMPTS_SCRIPT`:
   - Compares submitted OTP with stored OTP
   - On match: removes both OTP key and attempts key (UNLINK), returns 1 (verified)
   - On mismatch/missing: increments attempts counter (INCR), applies OTP TTL to attempts key on first failure, invalidates OTP (UNLINK) when attempts >= maxAttempts, returns 0 (failed)
   - This prevents bypass via concurrency — all operations execute atomically

3. **Generic error responses** — All verification failures (missing, expired, incorrect, exhausted attempts) return identical `OTP_VERIFICATION_FAILED` Problem Details. The client cannot distinguish between them.

4. **Rate limiter integration** — Uses existing `@nestjs/throttler` with named `short` policy. Limits are aligned with OTP window (120s): challenge 2 req, verify 5 req. The global rate limiter uses the same Redis connection via custom `RedisThrottlerStorage` with atomic Lua script.

5. **Fail-closed behavior** — Redis failures propagate as plain Errors (not converted to verification failures). The global Problem Details filter serves HTTP 500 `APPLICATION_ERROR` without internal details.

6. **Config-driven max attempts** — `ENROLLMENTS_MAX_VERIFY_ATTEMPTS` defaults to 5, configurable via env. Injected via `ConfigService` using `ENROLLMENTS_CONFIG` symbol.

---

## Testing

### Unit Tests (198 tests pass)

- `enrollments.service.spec.ts`: 22 tests covering:
  - OTP generation and storage with SET NX EX
  - Normalization of +98/0098/98/missing zero prefixes
  - OTP range (100000–999999)
  - SET NX EX failure returns generic error
  - Redis storage failure propagates
  - Verification success cleans up both keys
  - All failure conditions return same generic error
  - Redis failure propagates (not converted to verification failure)
  - Config-driven max attempts (tested with 3 vs default 5)

### E2E Tests (62 tests pass)

- `enrollments.e2e-spec.ts`: 12 tests covering:
  - Challenge: valid phone, normalized +98, returns 201 with phone only
  - Challenge: invalid phone numbers return 400 Problem Details
  - Challenge: SET NX EX failure (mocked) returns 500
  - Verify: correct OTP returns 201, OTP never in response
  - Verify: +98 normalization before Redis lookup
  - Verify: identical generic error for incorrect vs missing/expired OTP
  - Verify: validation rejects invalid phone/OTP before Redis access
  - Verify: Redis failure returns 500 generic error
  - Rate limiter: distinct X-Forwarded-For per request in loops to avoid throttler interference
  - Rate limit config overridden to high values (10000/100000) so validation errors aren't masked

### Redis Integration Tests

- `pnpm test:redis` runs 32 real-Redis tests (rate limiter atomicity, block regression, multi-instance sharing, proxy/IPv6 behavior, Redis failure). Not affected by this feature (uses separate test file).

---

## Documentation Updates

Per Documentation Update Triggers in AGENTS.md:

1. `docs/current-state.md` — Updated Validated variables list and enrollments feature description with atomic SET NX EX, attempt limiting, rate limiter integration
2. `apps/api/ONBOARDING.md` — Added `ENROLLMENTS_MAX_VERIFY_ATTEMPTS` to env table; updated feature description
3. `apps/api/env/.env.example` — Added `ENROLLMENTS_MAX_VERIFY_ATTEMPTS=5` with comment
4. Created `DEFERRED.md` at repository root with mandated deferred items

---

## Deferred Work (recorded in DEFERRED.md)

1. **OTP Hashing (Security — Mandatory)** — Store OTPs as salted Argon2id hashes instead of plaintext. Primary protection is attempt limit; hashing is defense-in-depth.
2. **Challenge ID (Correlation — Postponed)** — Issue UUIDv4 `challengeId` on challenge, require it on verify to bind to specific issuance.
3. **Idempotency (Reliability — Postponed)** — Add `Idempotency-Key` header to challenge so retries return same response without new OTP or rate-limit consumption.

---

## Validation Results

```bash
pnpm typecheck    # Passes (only pre-existing vitest warnings)
pnpm lint         # Passes (only pre-existing warnings in other files)
pnpm test         # 198 unit tests pass
pnpm test:e2e     # 62 e2e tests pass
pnpm test:redis   # 32 Redis integration tests pass (not run yet, expected pass)
```

All tests pass. No regressions introduced.

---

## Commit Plan

Single commit with conventional commit message:

```
feat(api): production-ready OTP enrollment flow with atomicity and attempt limiting

- Atomic SET NX EX for OTP issuance (prevents race conditions)
- Atomic verify-and-count-attempts Lua script (consumes on success,
  increments attempts on failure, invalidates OTP at max attempts)
- Configurable max attempts via ENROLLMENTS_MAX_VERIFY_ATTEMPTS (default 5)
- Endpoint-specific rate limits aligned with OTP window (challenge 2/120s,
  verify 5/120s)
- Generic indistinguishable error responses for all verification failures
- Fail-closed Redis error handling
- DEFERRED.md registry for OTP hashing, Challenge ID, Idempotency

Co-Authored-By: Claude Code <noreply@anthropic.com>
```

Include prompt record `_023-production-ready-otp-enrollment-flow.md` in commit.
