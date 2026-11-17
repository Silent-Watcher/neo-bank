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

---

## Mandated by Database Health-Probe Hardening (_053, ADR-036)

Per the "Subagent Findings: Persistence, Derived Rules, and Test Integrity" rules (root AGENTS.md): the following subagent findings were dispositioned in `docs/judge-findings.md` (Wave 23) but are out of scope for _053 — recorded here as follow-up work.

### 1. Blank-value trap in sibling `positiveSafeInteger` env variables (CR-05)

**Origin**: code-reviewer finding CR-05 (Low, 2026-11-17) — `docs/judge-findings.md` Wave 23 iteration 2.
**Status**: **Partially Done** (2026-11-17) — the Redis siblings (`REDIS_CONNECT_TIMEOUT_MS`, `REDIS_COMMAND_TIMEOUT_MS`, `REDIS_MAX_RETRIES_PER_REQUEST`, `REDIS_SHUTDOWN_TIMEOUT_MS`) were fixed during _054 (Wave 24 CR-01) via the shared `positiveIntegerEnv(field, default)` helper in `validation-helpers.ts`, with blank/whitespace spec coverage. **Still open**: `BODY_LIMIT` (`server.env.ts`) — same defect class, separate untouched file; apply the same helper plus its spec case.
**Requirement**: Apply the blank-to-unset helper (see `validation-helpers.ts` `positiveIntegerEnv` and `docs/ai-decisions.md` #23/#25 for the Zod pitfall) to `BODY_LIMIT` and add the matching spec cases. An operator copying `.env.example` verbatim still cannot boot the API with that entry left empty.
**Rationale**: one documented-contract violation remains for the last sibling.

### 2. Redis health-probe coalescing asymmetry (SEC-INFO-01)

**Origin**: code-security-analyzer SEC-INFO-01 (CWE-400, informational, 2026-11-17) — Wave 23 security review.
**Status**: **Done** (2026-11-17) — implemented by the Redis reliability task (_054) as `RedisHealthProbe` (`apps/api/src/shared/redis/redis.probe.ts`, ADR-037): single-flight over PING with a 5 s success / 3 s failure process-local cache and a 3 s probe deadline; verified by `redis.probe.spec.ts` and the Toxiproxy black-hole spec (`redis-black-hole.redis-spec.ts`).
**Requirement**: ~~give the Redis health indicator the same bounded single-flight + TTL-cache treatment the database probe received~~ — done.
**Rationale**: `/health` floods amplified into Redis PINGs at request rate while the DB side was capped.

### 3. Upper sanity bound for timeout/capacity environment variables (SEC-INFO-04, extended)

**Origin**: code-security-analyzer SEC-INFO-04 (CWE-20, informational, 2026-11-17) — Wave 23 security review; extended by the Wave 24 security review (SEC-04, 2026-11-17) to the Redis timeout variables.
**Status**: Open — operator-trusted config; caps are schema-behavior decisions requiring approval.
**Requirement**: evaluate adding generous named upper bounds (or cross-field warnings) so absurd well-formed values fail validation at startup: `DATABASE_POOL_MAX` (exhausts PostgreSQL `max_connections`), and `REDIS_SOCKET_TIMEOUT_MS` / `REDIS_COMMAND_TIMEOUT_MS` / `REDIS_CONNECT_TIMEOUT_MS` (an enormous socket timeout silently disables the ADR-037 black-hole recovery bound — per-command failures stay bounded, but socket destruction and reconnect recovery delay to keepalive scale).
**Rationale**: fail-fast robustness; the sizing/relationship guidance in the env files and ADR-036/ADR-037 is documentation, not enforcement.

### 4. Restrict `/health` reachability at the edge (SEC-INFO-03)

**Origin**: code-security-analyzer SEC-INFO-03 (CWE-200, informational, 2026-11-17) — Wave 23 security review.
**Status**: Open — deployment-level concern; nothing to change in application code.
**Requirement**: when production ingress exists, ensure firewall/ingress rules restrict `/health` and `/health/ready` to the orchestration network — subsystem-level health status and memory-protection events are exposed unauthenticated by design.
**Rationale**: the application layer intentionally serves orchestrator probes; network placement is the only real control.

---

## Mandated by ETag Hardening Review (_055, Wave 25 CR-06)

### 1. Unmapped built-in exception statuses publish the application-error Problem Type family

**Origin**: code-reviewer CR-06 (Low, 2026-11-17) — Wave 25 code review of the ADR-038 Phase 0 unit.
**Status**: Open — client-visible error-contract decision (ADR-010 territory) awaiting developer direction.
**Requirement**: decide how `errorCodeForStatus` handles built-in `HttpException` statuses outside the mapped set (e.g. 401/403): either extend the per-status map with non-typed codes (yielding RFC 9457 `about:blank` Problem Types) or route unmapped statuses to a generic non-typed code instead of the current `ErrorCode.ApplicationError` fallback — which today labels an ordinary 401/403 with `type: /problems/application-error`, `code: APPLICATION_ERROR`, and the "Application Error" title.
**Rationale**: no current thrower produces an unmapped status (guards throw only mapped codes), so no live path is affected; but any future guard or framework exception with an unmapped status would be misclassified by clients branching on `type`/`code`. The fix changes the error contract for unmapped statuses and therefore was not applied without approval.

### 2. Cache-Control directives for revalidatable responses (SEC-INFO, Wave 25)

**Origin**: code-security-analyzer SEC-01 (informational, CWE-525-adjacent, 2026-11-17) — Wave 25 security review of the ADR-038 Phase 0 unit.
**Status**: Open — cache-control policy decision, taken when authenticated, user-specific routes appear.
**Requirement**: decide which `Cache-Control` directives response classes carry now that revalidation (ETag/304) makes private-cache reuse of stored envelope bodies possible. Only the health routes set `Cache-Control: no-store` today; `Vary: Accept-Language` is already emitted by the i18n middleware. Candidate remediation when the decision matures: `Cache-Control: no-cache, private` (or `no-store`) on user-specific responses so revalidation semantics are explicit and shared intermediaries never store.
**Rationale**: cross-session reuse requires byte-identical application payloads and can only serve the prior envelope's metadata (random UUID + timestamp) — negligible today with no authentication; the policy should be fixed deliberately before user-specific data exists, not retrofitted.
