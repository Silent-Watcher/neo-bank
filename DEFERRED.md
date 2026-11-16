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

## Mandated by Fastify → NodeAdapter Migration (ADR-032)

### 1. ETag / Conditional-Request Support (Behavior Parity — Deferred)

**Origin**: ADR-032 acceptance decision, 2026-11-15 — the developer directed that ETag support be implemented later and recorded here instead of in the migration.
**Status**: Done (2026-11-15, same task) — implemented as `ConditionalRequestInterceptor` + shared ETag helpers (`apps/api/src/shared/http/etag.ts`): weak entity tags (`W/"<sha256>"`) over the application payload, `If-None-Match` → 304 for GET/HEAD (weak comparison), ETag (no revalidation) on other methods and Problem Details responses, SSE skipped. Verified by `test/conditional-request.e2e-spec.ts` and unit tests. Note: this is strictly more useful than the Fastify behavior it replaces — Fastify's strong tags covered the full envelope (fresh timestamp/request ID per response), so revalidation never actually succeeded in practice; the weak payload tag makes conditional caching work for the first time on this API.
**Requirement**: Restore conditional-request support lost with the Fastify removal. Fastify emitted strong ETags on JSON responses and answered `If-None-Match` with `304 Not Modified`; the NodeAdapter does neither. Responses from the API carry no `ETag` header, and conditional requests return full `200` bodies.
**Rationale**: No current handler or client builds on conditional caching, so the loss is invisible today; restoring it is an enhancement, not a migration blocker. Must not be silently forgotten since it is an observable regression versus the Fastify era.
**Implementation notes**:

- Implement on the adapter's request/response hook surface (`setOnRequestHook`/`setOnResponseHook`) or an interceptor at the HTTP boundary — keep it out of reusable components per the Platform-Agnostic Architecture rule.
- Generate strong ETags over the serialized response body; honor `If-None-Match` with `304` and no body, matching Fastify's prior semantics.
- Cover with regression tests: ETag presence on JSON responses, `If-None-Match` → 304, `If-None-Match` with a stale value → 200.
- Revisit together with the keep-alive constant (ADR-032) if a connection-pooling reverse proxy is introduced.

---

## Mandated by Database Governance Implementation (_051, ADR-033/ADR-034)

### 1. Enrollment Write-Path Data-Protection Decisions (Deferred)

**Origin**: code-security-analyzer finding SEC-02 (CWE-312, informational, 2026-11-16) — `docs/judge-findings.md` Wave 21 security review.
**Status**: Open — no write path exists yet; the `enrollments` table is provisioned but inert.
**Requirement**: When the first flow persists `Enrollment` rows, decide deliberately and implement: retention/cleanup policy, backup/encryption posture for the PII column, and reconcile the entity documentation's E.164 shape (`+1555…`) with the HTTP-facing `09XXXXXXXXX` normalization (`enrollments.schema.ts`) so the column never receives unvalidated input. **Phone-number uniqueness is explicitly rejected by the developer (2026-11-16, business logic): multiple `Enrollment` rows with the same `phone_number` are valid — never add a unique constraint on it.**
**Rationale**: The column is plaintext PII; nothing exploitable exists today (no read/write path, no HTTP surface), but the decisions above must not be made implicitly by the first feature that touches the table.

---

## How to Use This Registry

- When starting work on a deferred item, move it from this file to a new ADR proposal (or link to an existing one).
- Do not delete items — mark them **Done** with a reference to the ADR/commit.
- If a deferred item is explicitly rejected, mark **Won't Do** with rationale.
- Review this file at the start of each new feature to see if any deferred work is now relevant.
