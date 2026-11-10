# Security Assessment: OTP Enrollment Flow

**Date:** 2026-11-08 (updated 2026-11-10 for ADR-018 HMAC digest storage and ADR-019 verification hardening)
**Scope:** `apps/api/src/modules/enrollments/` — OTP issuance (`POST /enrollments/challenge`) and verification (`POST /enrollments/verify`)
**Related:** ADR-017 (OTP verification attempt lockout), ADR-018 (HMAC-SHA-256 digest storage), ADR-019 (conditional attempt counting + challenge identity), `.agents/rules/security-assessment.md`

---

## 1. System Model

### OTP Parameters

| Parameter                 | Value                                                                                                                                                         | Source                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| OTP length                | 6 digits                                                                                                                                                      | `enrollments.service.ts`                  |
| OTP range                 | 100000–999999                                                                                                                                                 | `OTP_MIN`/`OTP_MAX`                       |
| Secret space size         | 900,000                                                                                                                                                       | 999999 − 100000 + 1                       |
| OTP entropy               | ≈ 19.78 bits                                                                                                                                                  | `H = log2(900000) = 6 × log2(10)`         |
| Redis stored value        | `<challengeId>:<digest>` — UUIDv4 challenge ID + HMAC-SHA-256 digest (64 lowercase hex chars) keyed with `ENROLLMENTS_OTP_HMAC_SECRET` over `"<phone>:<otp>"` | `enrollments.otp-digest.ts` (ADR-018/019) |
| HMAC secret               | 32 bytes (64 hex chars), validated at startup, never stored in Redis, required env var                                                                        | `enrollments.env.ts`                      |
| OTP TTL                   | 120 s                                                                                                                                                         | `CHALLENGE_OTP_TTL_SECONDS`               |
| Max verify attempts       | 5 (configurable)                                                                                                                                              | `ENROLLMENTS_MAX_VERIFY_ATTEMPTS`         |
| Lockout TTL               | 900 s (15 min, configurable)                                                                                                                                  | `ENROLLMENTS_LOCKOUT_TTL_SECONDS`         |
| OTP sends per phone/hour  | 5                                                                                                                                                             | `MAX_OTP_SENDS_PER_HOUR`                  |
| Per-IP challenge throttle | 2 req / 120 s                                                                                                                                                 | `@Throttle` on controller                 |
| Per-IP verify throttle    | 5 req / 120 s                                                                                                                                                 | `@Throttle` on controller                 |

### Redis Keys

| Key                                                 | Purpose                                                              | TTL                 |
| --------------------------------------------------- | -------------------------------------------------------------------- | ------------------- |
| `neo-bank:enrollments:challenge:otp:<phone>`        | Stored OTP HMAC-SHA-256 digest (SET NX EX) — never the plaintext OTP | 120 s               |
| `neo-bank:enrollments:challenge:attempts:<phone>`   | Failed verification counter                                          | lockout TTL (900 s) |
| `neo-bank:enrollments:challenge:lockout:<phone>`    | Lockout flag (set at max attempts)                                   | lockout TTL (900 s) |
| `neo-bank:enrollments:challenge:rate-limit:<phone>` | Sorted set of send timestamps (rolling 60 min)                       | 3600 s              |

### Digest and Verification Flow (ADR-018, hardened by ADR-019)

- **Issuance:** `HMAC-SHA-256(ENROLLMENTS_OTP_HMAC_SECRET, "<phone>:<otp>")` is computed in Node.js and the hex digest is stored — bound to a fresh UUIDv4 challenge ID — as `<challengeId>:<digest>` via `ISSUE_OTP_SCRIPT`. The plaintext OTP never reaches Redis. The phone is bound into the HMAC input, so digests cannot be substituted between challenges (e.g. an attacker with Redis write access cannot copy the digest of an OTP they legitimately received for their own phone onto a victim's phone key).
- **Verification:** the submitted OTP's digest is computed in Node and compared against the stored digest with `crypto.timingSafeEqual` over 32-byte buffers. A missing or malformed stored value (wrong length, non-hex) is a failed match — never an exception, never a string-equality fallback.
- **Resolution:** a Lua script (`RESOLVE_OTP_VERIFICATION_SCRIPT`) performs **no digest comparison**; it atomically applies the Node-side result: lockout present → reject without counting; matched **and** the stored value's challenge ID still equals the verified one → consume otp/attempts/lockout; OTP key missing (expired/consumed/never issued) → reject **without creating any state** — a lockout can never arise without a live challenge (ADR-019); otherwise → count the attempt and set the lockout at max. The challenge-ID check (an identifier, not secret-derived material) closes the stale-match window: a replaced challenge is never consumed, and its verification falls to the attempt branch.

### State Machine (atomic Lua scripts)

**Issue (`ISSUE_OTP_SCRIPT`):**

1. If lockout key exists → return `locked` (no state change)
2. `SET otpKey <challengeId>:<digest> EX 120 NX` → `issued` if OK, `exists` otherwise

**Resolve (`RESOLVE_OTP_VERIFICATION_SCRIPT`):**

1. If lockout key exists → return `false` (no counter change — prevents lockout extension)
2. If Node-side `timingSafeEqual` matched AND the stored challenge ID still matches the verified one → UNLINK otp, attempts, lockout → return `true`
3. Else if the OTP key is missing → return `false` without creating any state (ADR-019)
4. Else INCR attempts (set TTL to lockout window on first failure); if attempts ≥ max → SET lockout key (EX lockout TTL) + UNLINK otp → return `false`

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

An attacker who knows a victim's phone can trigger a lockout by making 5 failed verification attempts against a live OTP. Cost to attacker: 1 OTP send (rate-limited to 5/hour per phone) + 5 verify requests (per-IP throttled 5/120 s, so from one IP it's exactly at the limit; more IPs needed). The victim is locked out for 15 min per trigger, max ~4 lockouts/hour given the send limit. Since ADR-019, this is the **only** remaining lockout path: verification against a missing, expired, or consumed OTP creates no state, so an attacker can no longer lock a phone out of issuance with garbage requests alone — a live challenge (costing an issuance quota slot) is required first. This remains a known trade-off of account-based lockouts; mitigations: keep lockout window moderate (900 s default), monitor for lockout-triggering patterns, consider per-IP + per-phone combined analysis in the future.

### 2.6 Concurrency / race conditions

All state transitions are in single Lua scripts (atomic in Redis):

- `ISSUE_OTP_SCRIPT`: lockout check + SET NX EX together — an OTP cannot be created while lockout is active, even if a concurrent verify sets the lockout between the rate-limit check and the issue.
- `RESOLVE_OTP_VERIFICATION_SCRIPT`: lockout check + challenge-ID check + consume/count + lockout-set together — concurrent verifications cannot exceed maxAttempts; exactly maxAttempts INCRs land before the lockout is set. The digest comparison itself happens in Node (`timingSafeEqual`) against a `GET` snapshot; the resolve script re-checks the challenge identity, key existence, and the lockout authoritatively, so a stale snapshot can neither consume a replaced challenge nor create lockout state without a live challenge (ADR-019).

Verified by Testcontainers tests (`test/enrollments-lockout.redis-spec.ts`): 6 concurrent wrong verifies → exactly 5 attempts counted, lockout set, 6th rejected without incrementing; garbage verification without any challenge creates no attempts and no lockout; a matched OTP whose key disappeared before the resolve is not consumed; a replaced challenge is never consumed through a stale match (the replacement still verifies normally).

### 2.7 OTP value leakage

- The plaintext OTP is never returned in any API response (challenge returns only `{ phoneNumber }`).
- The plaintext OTP is never stored in Redis — only the HMAC-SHA-256 digest keyed with a secret held outside Redis (ADR-018).
- OTP is never logged (no `console.log`; Pino logger used; OTP not passed to logger; the HMAC secret is never logged).
- All failure modes (missing/expired/incorrect/locked/exhausted) return the identical generic `OTP_VERIFICATION_FAILED` Problem Details.
- Lockout on challenge returns the identical `OTP_RATE_LIMIT_EXCEEDED` generic message as the hourly quota — lockout state is not distinguishable.
- Digest comparison uses `crypto.timingSafeEqual` over fixed-length 32-byte buffers; `timingSafeEqual` protects the byte comparison itself and does not neutralize every conceivable timing side channel of the endpoint. The comparison inside Redis performs no secret-derived comparison at all.

### 2.8 Redis compromise threat model (ADR-018)

**Scenario A — Redis read-only compromise (digests only).** The attacker obtains the stored HMAC digests but not `ENROLLMENTS_OTP_HMAC_SECRET`. Without the key, a candidate OTP cannot be checked against a digest: the HMAC is a pseudorandom function of the input under a secret key, so each guess yields an unverifiable 256-bit value. Offline enumeration of the 900,000-value space is impossible without the key; brute-forcing the HMAC key itself (32 bytes) is computationally infeasible. **The previously documented plaintext exposure is eliminated.**

**Scenario B — Redis compromise plus HMAC secret compromise.** With both the digests and the key, verification is fully possible offline: the attacker enumerates all 900,000 candidate OTPs and computes one HMAC each. This is computationally trivial — the OTP's own ~19.78 bits of entropy are the only remaining barrier, not the HMAC. HMAC therefore does **not** make OTPs uncrackable in this scenario; its value depends entirely on the secret being protected independently of Redis (env files/secret manager, never in Redis, never in logs, never reused from other credentials).

**Scenario C — online OTP guessing.** Unchanged by ADR-018. Online resistance still depends exclusively on the OTP entropy, the 5-attempt limit, the 900 s lockout, the per-phone hourly send quota, the per-IP throttles, and the 120 s TTL. The probabilities in §3 apply unchanged; digest storage adds no online-guessing protection and removes none.

**Redis write access** is not mitigated beyond phone binding: an attacker who can write can delete or poison OTP state (denial of verification) as before.

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
- The table's probabilities cover the **online** attack surface (Scenario C) and are unchanged by ADR-018 digest storage; offline feasibility is governed by Scenario A/B in §2.8.
- Attacker cannot bypass per-phone rate limit (5 sends/hour) — enforced atomically in Redis.
- Lockout TTL enforced by Redis with ±1 s accuracy.
- Rate limit window (60 min rolling) and lockout window (15 min) are independent; both enforced atomically.
- `ENROLLMENTS_OTP_HMAC_SECRET` is protected independently of Redis (Scenario A); if it leaks together with Redis data, see Scenario B.

**Security target:** P(success) < 10⁻⁴ per hour under worst-case attack → **met** (2.22 × 10⁻⁵).

---

## 4. Remaining Risks

1. **OTP digest protection depends on the HMAC secret** (resolved from the former "OTP stored in plaintext in Redis" risk, ADR-018) — a Redis read-only compromise no longer exposes usable OTPs (§2.8 Scenario A), but if the secret is compromised alongside Redis, digests are brute-forceable at the OTP's ~19.78-bit entropy (§2.8 Scenario B). The secret must be provisioned and rotated outside Redis; rotating it invalidates pending OTPs (≤120 s of in-flight codes).
2. **Lockout-triggering DoS** — see §2.5. Since ADR-019, triggering a lockout requires a live OTP challenge (an issuance quota slot), not just garbage requests; bounded by rate limits but still possible; monitor in production.
3. **No SMS delivery yet** — OTP is never sent; the flow is not yet exposed to real users.
4. **Per-IP throttles rely on `trustProxy`** — if misconfigured behind a proxy that doesn't set X-Forwarded-For, all clients share one IP bucket. Verified in `http-config.e2e-spec.ts`.
5. **Distributed brute force across many phones** — each phone is independently limited; global rate limiting exists via throttler but per-phone attack is the relevant threat here.
6. **Redis write access remains disruptive** — digest storage does not prevent an attacker with Redis write access from deleting OTPs, copying keys (phone binding + challenge ID block cross-challenge digest substitution but not state poisoning), or triggering lockouts.
