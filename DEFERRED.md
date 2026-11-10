# DEFERRED.md — Deferred Work Registry

This file tracks explicitly deferred work items that are out of scope for the
current feature but must not be lost. Items here are **mandated** by the
original task requirements and must be addressed in future work.

> **Rule**: Do not add items here for convenience. Only mandated deferrals from
> the task specification or explicit user decisions belong here. For optional
> improvements, create an ADR or issue instead.

---

## Mandated by Enrollment OTP Implementation (feature/enrollments)

### 1. OTP Hashing (Security — Mandatory)

**Origin**: Task specification, Phase 7 — "OTP hashing (deferred)".
**Status**: Done (2026-11-10) — implemented as keyed HMAC-SHA-256 digest storage, not Argon2id; see ADR-018 for why HMAC is the correct primitive for keyed OTP verification (Argon2id's password-hashing cost is unwarranted for a 6-digit verifiable code).
**Requirement**: Store OTPs as salted hashes (e.g., Argon2id) instead of plaintext in Redis so a Redis compromise does not expose usable OTPs. Implemented as HMAC-SHA-256 digests keyed with `ENROLLMENTS_OTP_HMAC_SECRET` (held outside Redis); verification compares digests in Node with `crypto.timingSafeEqual`.
**Rationale**: The attempt limit is the primary protection against brute force; an unsalted hash would not meaningfully resist offline attacks. Hashing is a defense-in-depth layer.
**Implementation notes**:

- Use a constant-time comparison for verification.
- Store: `{ hash: <argon2id>, salt: <base64>, algorithm: "argon2id", version: 19 }` (or similar structured value).
- Migration: On next OTP issuance, hash the generated OTP before storing; verification uses `argon2.verify()`.
- Consider key rotation if the hashing parameters change.

### 2. Challenge ID (Correlation — Postponed)

**Origin**: Task specification — "Challenge ID (postponed)".
**Status**: Deferred.
**Requirement**: Issue a UUIDv4 `challengeId` on `POST /enrollments/challenge`, store it alongside the OTP, and require it on `POST /enrollments/verify` to bind the verification to a specific challenge issuance.
**Rationale**: Prevents request smuggling / cross-request confusion if a user has multiple concurrent challenges. Currently the phone number alone is the correlation key.
**Implementation notes**:

- Add `challengeId` to the OTP Redis value (JSON: `{ otp, challengeId, issuedAt }`).
- Return `challengeId` in the challenge response (envelope `data`).
- Require `challengeId` in verify request body (Zod schema).
- Verify `challengeId` matches stored value in the atomic Lua script.
- Deferred because the current single-challenge-per-phone model works for the minimal flow; becomes necessary when SMS delivery adds latency and retries.

### 3. Idempotency (Reliability — Postponed)

**Origin**: Task specification — "Idempotency (postponed)".
**Status**: Deferred.
**Requirement**: Add an `Idempotency-Key` header to `POST /enrollments/challenge` so retries return the same response without generating a new OTP or consuming rate-limit quota.
**Rationale**: Clients may retry on network failure; without idempotency a retry could consume a rate-limit slot or (before SET NX EX) overwrite the OTP. Now SET NX EX prevents overwrite but a retry still consumes the rate-limit quota and returns a generic error.
**Implementation notes**:

- Use a separate Redis key: `neo-bank:enrollments:challenge:idempotency:<key>` with 120s TTL.
- Store the response body (or just the OTP + phone) on first success.
- On subsequent requests with same key, return stored response.
- Check idempotency key before rate limiting (or exclude idempotent retries from quota).
- Deferred because the current flow is minimal; becomes necessary when SMS delivery adds cost and retry storms are a real risk.

---

## How to Use This Registry

- When starting work on a deferred item, move it from this file to a new ADR proposal (or link to an existing one).
- Do not delete items — mark them **Done** with a reference to the ADR/commit.
- If a deferred item is explicitly rejected, mark **Won't Do** with rationale.
- Review this file at the start of each new feature to see if any deferred work is now relevant.
