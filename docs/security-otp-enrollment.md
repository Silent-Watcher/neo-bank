# Security Assessment: OTP Enrollment Flow

**Date:** 2026-11-08
**Scope:** `apps/api/src/modules/enrollments/` — OTP issuance (`POST /enrollments/challenge`) and verification (`POST /enrollments/verify`)
**Related:** ADR-017 (OTP verification attempt lockout), `.agents/rules/security-assessment.md`

---

## 1. System Model

### OTP Parameters

| Parameter                 | Value                        | Source                            |
| ------------------------- | ---------------------------- | --------------------------------- |
| OTP length                | 6 digits                     | `enrollments.service.ts`          |
| OTP range                 | 100000–999999                | `OTP_MIN`/`OTP_MAX`               |
| Secret space size         | 900,000                      | 999999 − 100000 + 1               |
| OTP TTL                   | 120 s                        | `CHALLENGE_OTP_TTL_SECONDS`       |
| Max verify attempts       | 5 (configurable)             | `ENROLLMENTS_MAX_VERIFY_ATTEMPTS` |
| Lockout TTL               | 900 s (15 min, configurable) | `ENROLLMENTS_LOCKOUT_TTL_SECONDS` |
| OTP sends per phone/hour  | 5                            | `MAX_OTP_SENDS_PER_HOUR`          |
| Per-IP challenge throttle | 2 req / 120 s                | `@Throttle` on controller         |
| Per-IP verify throttle    | 5 req / 120 s                | `@Throttle` on controller         |

### Redis Keys

| Key                                                 | Purpose                                        | TTL                 |
| --------------------------------------------------- | ---------------------------------------------- | ------------------- |
| `neo-bank:enrollments:challenge:otp:<phone>`        | Stored OTP (SET NX EX)                         | 120 s               |
| `neo-bank:enrollments:challenge:attempts:<phone>`   | Failed verification counter                    | lockout TTL (900 s) |
| `neo-bank:enrollments:challenge:lockout:<phone>`    | Lockout flag (set at max attempts)             | lockout TTL (900 s) |
| `neo-bank:enrollments:challenge:rate-limit:<phone>` | Sorted set of send timestamps (rolling 60 min) | 3600 s              |

### State Machine (atomic Lua scripts)

**Issue (`ISSUE_OTP_SCRIPT`):**

1. If lockout key exists → return `locked` (no state change)
2. `SET otpKey value EX 120 NX` → `issued` if OK, `exists` otherwise

**Verify (`VERIFY_OTP_ATTEMPTS_SCRIPT`):**

1. If lockout key exists → return `false` (no counter change — prevents lockout extension)
2. If stored OTP == submitted → UNLINK otp, attempts, lockout → return `true`
3. Else INCR attempts (set TTL to lockout window on first failure); if attempts ≥ max → SET lockout key (EX lockout TTL) + UNLINK otp → return `false`

---

## 2. Attack Scenarios Evaluated

### 2.1 Brute-force within a single OTP

Attacker requests OTP, then guesses. Max 5 wrong guesses before lockout.

**P(success per lockout window) = 1 − (1 − 1/900000)^5 ≈ 5.56 × 10⁻⁶** (0.000556%)

### 2.2 Bypass via OTP regeneration (pre-fix vulnerability — now fixed)

Before ADR-017, after max attempts the OTP key was deleted, so `SET NX EX` succeeded immediately for a new OTP. The attempts counter persisted only for 120 s (OTP TTL), so:

- Within 120 s of first failure: each new OTP gave 1 extra guess (attempts already ≥ max → immediate invalidation) → 9 guesses/hour with 5 sends.
- After 120 s: attempts key expired → fresh 5 guesses per new OTP → up to 25 guesses/hour.
- **Critical pre-fix flaw:** the verify success path did not check the attempts counter, so a correct guess on a newly-issued OTP after max attempts still succeeded.

**Post-fix (ADR-017):** lockout key blocks both issuance and verification for 900 s. OTP regeneration cannot reset it. Guessing is capped at exactly `maxAttempts` per lockout window.

### 2.3 Distributed attack (many IPs)

Per-IP throttles (2/120 s challenge, 5/120 s verify) are not binding. The binding constraints are:

- Per-phone hourly send limit: 5 OTPs / rolling 60 min
- Lockout: 5 attempts per 900 s window; sends blocked during lockout

Worst case per hour: 4 lockout windows × 5 attempts = **20 guesses/hour**

**P(success per hour) = 1 − (1 − 1/900000)^20 ≈ 2.22 × 10⁻⁵** (0.00222%)

### 2.4 Verification spam during lockout (DoS on the victim)

During lockout, verify rejects without incrementing attempts, so the attacker cannot extend the lockout via verification. Lockout TTL is fixed at 900 s from when max attempts was reached.

### 2.5 Lockout-triggering DoS (locking out a victim's phone)

An attacker who knows a victim's phone can trigger a lockout by making 5 failed verification attempts (requires an active OTP + 5 verify requests). Cost to attacker: 1 OTP send (rate-limited to 5/hour per phone) + 5 verify requests (per-IP throttled 5/120 s, so from one IP it's exactly at the limit; more IPs needed). The victim is locked out for 15 min per trigger, max ~4 lockouts/hour given the send limit. This is a known trade-off of account-based lockouts; mitigations: keep lockout window moderate (900 s default), monitor for lockout-triggering patterns, consider per-IP + per-phone combined analysis in the future.

### 2.6 Concurrency / race conditions

All state transitions are in single Lua scripts (atomic in Redis):

- `ISSUE_OTP_SCRIPT`: lockout check + SET NX EX together — an OTP cannot be created while lockout is active, even if a concurrent verify sets the lockout between the rate-limit check and the issue.
- `VERIFY_OTP_ATTEMPTS_SCRIPT`: lockout check + compare + INCR + lockout-set together — concurrent verifications cannot exceed maxAttempts; exactly maxAttempts INCRs land before the lockout is set.

Verified by Testcontainers tests (`test/enrollments-lockout.redis-spec.ts`): 6 concurrent wrong verifies → exactly 5 attempts counted, lockout set, 6th rejected without incrementing.

### 2.7 OTP value leakage

- OTP is never returned in any API response (challenge returns only `{ phoneNumber }`).
- OTP is never logged (no `console.log`; Pino logger used; OTP not passed to logger).
- All failure modes (missing/expired/incorrect/locked/exhausted) return the identical generic `OTP_VERIFICATION_FAILED` Problem Details.
- Lockout on challenge returns the identical `OTP_RATE_LIMIT_EXCEEDED` generic message as the hourly quota — lockout state is not distinguishable.

---

## 3. Quantitative Summary

| Scenario                                                                                                              | Guesses | P(success)                                                            |
| --------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------- |
| Single OTP, no regeneration (per lockout window)                                                                      | 5       | 1 − (899999/900000)⁵ ≈ **5.56 × 10⁻⁶**                                |
| One hour, worst case (4 lockout windows, lockout blocks sends)                                                        | 20      | 1 − (899999/900000)²⁰ ≈ **2.22 × 10⁻⁵**                               |
| One hour, pre-fix (attempts reset per OTP, 5 OTPs × 5)                                                                | 25      | ≈ 2.78 × 10⁻⁵ (and unbounded across hours if attacker waits out TTLs) |
| 24 hours, post-fix (96 windows × 5, if sends allowed — capped by 5 sends/hour = 120 OTPs/day → 120 × 5 = 600 guesses) | 600     | 1 − (899999/900000)⁶⁰⁰ ≈ **6.67 × 10⁻⁴**                              |

**Assumptions:**

- OTP is uniformly random over 900,000 values (`crypto.randomInt` — CSPRNG).
- No side channel reveals OTP values (SMS delivery not yet implemented; no logging).
- Attacker cannot bypass per-phone rate limit (5 sends/hour) — enforced atomically in Redis.
- Lockout TTL enforced by Redis with ±1 s accuracy.
- Rate limit window (60 min rolling) and lockout window (15 min) are independent; both enforced atomically.

**Security target:** P(success) < 10⁻⁴ per hour under worst-case attack → **met** (2.22 × 10⁻⁵).

---

## 4. Remaining Risks

1. **OTP stored in plaintext in Redis** — acceptable for short-lived (120 s) values with attempt limits; hashing deferred (DEFERRED.md). If Redis is compromised, active OTPs are readable.
2. **Lockout-triggering DoS** — see §2.5. Bounded by rate limits but still possible; monitor in production.
3. **No SMS delivery yet** — OTP is never sent; the flow is not yet exposed to real users.
4. **Per-IP throttles rely on `trustProxy`** — if misconfigured behind a proxy that doesn't set X-Forwarded-For, all clients share one IP bucket. Verified in `http-config.e2e-spec.ts`.
5. **Distributed brute force across many phones** — each phone is independently limited; global rate limiting exists via throttler but per-phone attack is the relevant threat here.
