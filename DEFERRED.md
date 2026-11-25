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
**Status**: Done (2026-11-20) — Phase 1 shipped as ADR-039: the official `@nestjs/idempotency` (0.0.4) with a custom Redis-backed `IdempotencyStore` (`apps/api/src/shared/idempotency/` — four atomic Lua scripts via ioredis `defineCommand` on the shared client; records under `neo-bank:idempotency:store:record:<sha256hex>`, the SHA-256 of the package's `scope:key`), applied to `POST /enrollments/challenge` via `@Idempotent()`: required `Idempotency-Key` header, HMAC-SHA-256(`IDEMPOTENCY_SCOPE_SECRET`, normalized phone) scope, normalized-phone fingerprint (equivalent `+98`/`0098`/`98`/missing-zero spellings share one scope), completed-record TTL 24 h / in-flight lock 60 s (renewed every lockTtl/3) / retry-after 1 s, and `storeIf` excluding 429 and 5xx. The endpoint answers an empty `202` (no envelope, no phone number); replays and in-flight duplicates consume no rate-limit quota because enforcement is deferred past the idempotency acquire gate (`@DeferredRateLimit()` + `DeferredRateLimitGuard` + route-level `ChallengeRateLimitInterceptor`). Package rejections map onto `ErrorCode.IdempotencyKey*` Problem Details with localized en/fa titles and details. **Phase 2 — idempotency across the external SMS provider boundary — remains deferred** (see "Mandated by Enrollment Challenge Idempotency (ADR-039)" below).
**Requirement**: Add an `Idempotency-Key` header to `POST /enrollments/challenge` so retries return the same response without generating a new OTP or consuming rate-limit quota.
**Rationale**: Clients may retry on network failure; without idempotency a retry could consume a rate-limit slot or (before SET NX EX) overwrite the OTP.

---

## Mandated by Enrollment Challenge Idempotency (ADR-039)

### 1. Phase 2 — Idempotency Across the External SMS Provider Boundary (Reliability — Deferred)

**Origin**: ADR-039 implementation, 2026-11-20 — Phase 1 makes the HTTP boundary idempotent; the ADR's scope decision explicitly excludes the external SMS provider, and this follow-up is mandated before SMS delivery goes live.
**Status**: Deferred — blocked on the SMS provider integration itself.
**Requirement**: Idempotent delivery across the provider boundary. The failure scenario Phase 1 cannot cover: the server sends the SMS delivery request → the provider sends the SMS → the network interrupts before the outcome is learned → the app never learns what happened → a retry (automatic or client-driven) produces a duplicate SMS and duplicate charges. Delivery must therefore be idempotent across the boundary, covering: provider-side idempotency support (client-supplied dedup key on the delivery API), a stable provider key that survives app retries, explicit timeout/ambiguous-outcome handling, delivery-state persistence, restart/multi-instance safety, retry/backoff policies, error classification, reconciliation (outcomes learned after the fact), webhooks/delivery callbacks, duplicate prevention across the combination of app retries and provider-side retries, observability with correlation IDs, and fault-injection tests (timeouts after acceptance, duplicated deliveries, callback races).
**Rationale**: A Transactional Outbox alone does not guarantee exactly-once delivery across the boundary — the provider is an independent failure domain and may execute a request whose outcome the application never observed. Related Phase 1 consequence: once an external side effect can precede the response, a `5xx` after that side effect is no longer safely re-executable, so the challenge `storeIf` policy (which excludes all 5xx today, ADR-039) may need a deliberately different policy for such endpoints.
**Implementation notes**:

- Decide the provider contract first: whether the provider accepts a client-supplied idempotency key; if it does not, duplicate prevention must be app-side with delivery state persisted before the outbound call.
- Persist the delivery attempt with an explicit state machine (pending → sent/unconfirmed → confirmed/failed); resolve ambiguous outcomes by provider status query or delivery callback — never by blind resend.
- Every state transition and retry decision must survive restarts and run correctly with multiple API instances (no in-memory-only state).
- Cover the ambiguous-outcome path with fault-injection tests (MockServer/Toxiproxy) before go-live.

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
**Requirement**: When the first flow persists `Enrollment` rows, decide deliberately and implement: retention/cleanup policy, backup/encryption posture for the PII column, and reconcile the entity documentation's E.164 shape (`+1555…`) with the HTTP-facing `09XXXXXXXXX` normalization (`enrollments.schema.ts`) so the column never receives unvalidated input. ~~**Phone-number uniqueness is explicitly rejected by the developer (2026-11-16, business logic): multiple `Enrollment` rows with the same `phone_number` are valid — never add a unique constraint on it.**~~ **Superseded (2026-11-22, Enrollment master prompt Phase 0): the developer now requires at most one non-expired `Enrollment` per normalized phone number, enforced by a PostgreSQL partial unique index on `phone_number` (`WHERE status <> 'EXPIRED'`) plus persisted lifecycle status. See root `AGENTS.md` → "Neo Bank Business Domain"; the new forward migration lands with the first Enrollment write path (Phase 2).** The retention/backup/encryption and phone-shape decisions remain open.
**Rationale**: The column is plaintext PII; nothing exploitable exists today (no read/write path, no HTTP surface), but the decisions above must not be made implicitly by the first feature that touches the table.

---

## Mandated by the Enrollment Core Data Model Phase (_060, ADR-041)

### 1. Migration-Replay Parity Smoke Test (Deferred)

**Origin**: migration review of `Migration20261122000737` (2026-11-22, INFO finding 3 — the dedicated `migration-reviewer` subagent was unavailable on the platform; the review ran through the `code-reviewer` subagent + primary-agent checklist per the documented fallback).
**Status**: **Done** (2026-11-22, Phase 3 / `_061`) — `apps/api/test/migrations-parity.db-spec.ts` replays every migration from zero through the real Migrator (`migrationsList` with explicit classes, no snapshot) on a fresh Testcontainers PostgreSQL and asserts the same column/constraint/index shape the metadata tier asserts. Gotchas encoded in the spec: v7 API is `orm.migrator` / `migrator.getPending()`; direct `MikroORM.init` needs `metadataProvider: ReflectMetadataProvider` and `clientUrl` (a URL in `dbName` drops the password at SASL).
**Rationale**: Migration files can drift from entity metadata silently; the review verifies parity once, a Migrator-based spec verifies it on every run.

### 2. Pool-Lifecycle Test Relocation (Deferred)

**Origin**: code review of `_060` (Wave 31 finding CR-07, 2026-11-22) — `test/enrollment.db-spec.ts` hosted the `DatabaseLifecycleLogger` pool-listener test (ADR-034), which is infrastructure coverage, not Enrollment coverage.
**Status**: **Done** (2026-11-22, Phase 3 / `_061`) — the test moved to `apps/api/test/database-lifecycle.db-spec.ts` (self-contained probe-app pattern); the enrollment db-spec carries only data-model coverage. db-tier `hookTimeout` raised to 30 s (container boots under Docker load exceed the 10 s default).
**Rationale**: A reader scanning the enrollment suite finds an infrastructure test, and the lifecycle coverage follows the enrollment file's fate in future refactors.

### 3. Enrollment db-spec Fixture Parameterization (Deferred)

**Origin**: code review of `_060` (Wave 31 CR-10 remainder, 2026-11-22) — the `insertEnrollmentSql(phone, status?)` fixture helper in `test/enrollment.db-spec.ts` interpolated its compile-time test literals into raw SQL; the Mimosa security gate flagged the pattern as injection-shaped and blocked Edit-tool writes (a catch-22: the scanner greps the pre-state, so even the removal diff was blocked).
**Status**: **Done** (2026-11-22) — at the developer's explicit direction the helper was replaced via a structural rewrite script; the fixture is fully parameterized and all matcher sites use `ENROLLMENT_SCHEMA_CONSTRAINT_NAMES`. Post-rewrite: typecheck clean, unit 504/504, db 36/36, e2e 115/115, redis 89/89.
**Rationale**: The interpolated-SQL shape was the scanner's flagged pattern; parameterization removed it and is the production-grade shape anyway.

### 4. Enrollment Write-Path Payload Construction Constraints (Deferred)

**Origin**: security review of `_060` (Wave 32 findings SEC-01/SEC-03, 2026-11-22).
**Status**: Open — binding for the Phase 4/5 Enrollment write path.
**Requirement**: (a) Construct creation payloads explicitly — `em.create(Enrollment, { phoneNumber: normalizedPhone })` — and never spread request input; create DTOs must exclude `publicId`, `status`, `currentStep`, `createdAt`, and `expiresAt` (SEC-03, CWE-915: a smuggled `status: 'APPROVED'` would satisfy the value-set CHECKs and bypass the lifecycle). Add a regression test asserting a create-path request cannot influence those fields. (b) Document the uuidv7 timestamp trade-off (SEC-01, CWE-359: `publicId` embeds the creation instant to millisecond precision) in the docs of the first endpoint that exposes `publicId`.
**Rationale**: The database CHECKs validate value sets, not state transitions; payload hygiene at the application boundary is the lifecycle's actual enforcement point until the Phase 4 state machine adds transition guards.

## Mandated by the Enrollment Step Data Model Phase (_061, ADR-042)

### 1. Derive the Zod Phone Pattern from the Shared Format Constant (Deferred)

**Origin**: code review of `_061` (Wave 33 finding CR-03, 2026-11-22) — `ENROLLMENT_PHONE_NUMBER_FORMAT` now single-sources the entity's phone CHECK, but `IRANIAN_MOBILE_PATTERN` in `enrollments.schema.ts` still carries its own `/^09\d{9}$/` literal.
**Status**: Open — natural fit with the Phase 6 step-submission schemas.
**Requirement**: Replace the Zod-side pattern literal with one derived from `ENROLLMENT_PHONE_NUMBER_FORMAT` (`new RegExp(...)`, `d` ↔ `[0-9]` equivalence checked against PostgreSQL POSIX behavior), keeping the i18n validation messages intact.
**Rationale**: A future format change must then land in exactly one place; today the application layer and the database could drift.

### 2. Parity-Tier CHECK Expression-Body Comparison (Deferred)

**Origin**: code review of `_061` (Wave 33 finding CR-04, 2026-11-22) — the parity tier asserts constraint names, column defaults, and types, but not the CHECK expression _bodies_; a migration regression in an expression body would pass both tiers.
**Status**: Open.
**Requirement**: Compare `pg_get_constraintdef` output against the metadata `checks[].expression` (normalized — `\$` template-literal escaping, POSIX quoting) in `migrations-parity.db-spec.ts`, closing the entity↔migration parity claim fully.
**Rationale**: The parity tier currently proves shape, names, defaults, and predicates; expression bodies remain covered by the migration review only.

### 3. Password-Hash Column Bound at the Phase 6 Write Path (Deferred)

**Origin**: security review of `_061` (Wave 34 finding SEC-02, 2026-11-22, CWE-20) — `password_hash` is text with no length cap by design (application-generated only); a Phase 6 regression mapping client input to the column would persist unbounded data with no DB signal.
**Status**: Open — binding for the Phase 6 PASSWORD step.
**Requirement**: When the write path lands, add an application-side bounded invariant (named constant for the expected hash format/length, asserted at the Zod→service boundary) or a DB CHECK in that phase's migration, plus a test proving client input never reaches the column verbatim (hashing happens first).
**Rationale**: The column is inert today; the bound is only meaningful together with the hashing implementation it protects.

### 4. Expiration Transition Is a Security Dependency of Identifier Release (Deferred)

**Origin**: security review of `_061` (Wave 34 finding SEC-03, 2026-11-22, CWE-672) — all three identifier-release predicates key exclusively on persisted `status <> 'EXPIRED'`; time-based expiry alone releases nothing, so stale rows could squat phone numbers, usernames, or national codes if the write path ships without reliable expiration.
**Status**: Open — binding for the Phase 4/5 write path.
**Requirement**: The lazy expiration transition (persisted before any rejection, master prompt §3.3/§11.1) must land with — or before — the first Enrollment write path; the future background expiration job (deferred by the master prompt) remains the operational backstop. The DB-side design itself is sound and race-free.
**Rationale**: Identity-occupation denial of service is the failure mode; the persisted-status transition is the release mechanism the database indexes depend on.

### 5. National-Code Collision Responses Must Be Indistinguishable (Deferred)

**Origin**: security review of `_061` (Wave 34 finding SEC-04, 2026-11-22, CWE-204) — once the write path surfaces unique-violation errors, distinct "national code already enrolled" responses enable third-party national-code enumeration (the format is public knowledge; enrollment presence is sensitive). Username-taken disclosure is standard UX.
**Status**: Open — binding for the Phase 6 step-submission APIs.
**Requirement**: Map national-code collisions to the generic, indistinguishable error contract per the root Error Response Security rules (detailed diagnostics in logs only); apply rate limiting to step submission; decide a deliberate username reservation policy (the CHECK charset permits `admin`, `system`, etc.).
**Rationale**: Bulk verification of national-code enrollment status is a privacy violation against non-consenting third parties; the distinction must be a deliberate Phase 6 design decision, not an accident of constraint-name surfacing.

---

## Mandated by the Enrollment State Machine Phase (_062, master prompt §10/§11)

### 1. Step-Submission Endpoint Must Authenticate the Challenger Before Mapping State Errors (Deferred)

**Origin**: security review of `_062` (Wave 36 finding SEC-01, 2026-11-22, CWE-203) — the machine's 410 (`ENROLLMENT_EXPIRED`) vs 409 (`ENROLLMENT_STEP_NOT_ALLOWED`) distinction becomes a lifecycle-state probing oracle if a Phase 6 endpoint maps those errors for unauthenticated or insufficiently authorized callers.
**Status**: Open — binding for the Phase 6 step-submission APIs (authorization is explicitly deferred by the master prompt; this records the constraint).
**Requirement**: Authenticate the OTP challenger and authorize it against the enrollment before invoking `EnrollmentStateMachine.executeStep`; never map `EnrollmentStateMachineError` for unauthenticated/unauthorized callers (fall through to the generic not-found/unauthorized semantics). `publicId` remains an identifier, never proof of authorization.
**Rationale**: One bit-class of lifecycle state per probe is the worst-case disclosure; the guard belongs to the flow, not the identifier.

### 2. Persist-Before-Map Discipline and the Expired-Condition Status Split (Deferred)

**Origin**: security review of `_062` (Wave 36 finding SEC-02, 2026-11-22) — a due-but-unpersisted row answers 410 `ENROLLMENT_EXPIRED` while an already-persisted `EXPIRED` row answers 409 `ENROLLMENT_STEP_NOT_ALLOWED`; both the persist-before-map ordering and the representative status for the identical expired condition are caller decisions.
**Status**: Open — binding for the Phase 6 step-submission APIs.
**Requirement**: Persist the expiration in the same EntityManager fork before mapping the rejection (master prompt §11.1); decide deliberately whether an already-`EXPIRED` row should also answer 410 so the expired condition keeps a single representative status code, and document the choice for clients.
**Rationale**: The worst case without the discipline is a transient response/database divergence (self-healing on the next lazy pass, no integrity violation); the split is a client-contract consistency decision that must be explicit rather than accidental.

### 3. Optimistic-Lock Failure Mapping Must Stay Caller-Owned for Machine Workflows (Deferred)

**Origin**: security review of `_062` (Wave 36 clean-checklist note carried forward) — concurrent step submissions and the expiration/submission race serialize on the inherited optimistic-lock version column, surfacing through `mapOptimisticLockError` → 409 `VersionConflict`.
**Status**: Open — binding for the Phase 6 step-submission APIs.
**Requirement**: Wrap `flush()` (and `em.lock`, where used) in the try block that maps through `mapOptimisticLockError`, per the established convention; never blanket-retry a machine-driven update whose result is ambiguous.
**Rationale**: The mapping is proven at the database tier; keeping it caller-owned preserves the no-automatic-retry rule for operations with side effects.

---

## Mandated by the Enrollment Step Submission APIs Phase (_064, master prompt §12 Phase 6)

### 1. BOLA Exposure on Step-Submission Endpoints (Security — Deferred by Developer)

**Origin**: master prompt §12 Phase 6 "Authorization Deferral" + security review of _064 (Wave 37 finding SEC-01, 2026-11-24, CWE-639) — the eight `POST /api/v1/enrollments/:publicId/step/:step-name` endpoints use `publicId` as the lookup key without ownership verification.
**Status**: Open — explicitly deferred by the developer (master prompt §13.5). The temporary BOLA exposure is documented here per the master prompt's requirement.
**Requirement**: Before production exposure of customer-specific Enrollment operations, implement an authentication/authorization guard that verifies the caller possesses the OTP challenge proof for the enrollment's phone number (e.g., a short-lived session token or signed JWT issued on `POST /enrollments/verify`). `publicId` must never be treated as proof of authorization. The guard must run before `EnrollmentStateMachine.executeStep` is invoked, and state-machine errors must never be mapped for unauthenticated/unauthorized callers (DEFERRED _062 #1).
**Rationale**: Any party with a `publicId` can currently advance, edit, or complete another user's enrollment. UUIDv7 embeds a timestamp; combined with leakage vectors (logs, Referer, shoulder-surfing), this is a real takeover vector. The fix is a separate future feature (Phase 7+), not part of Phase 6.

### 2. Password-Hash Column Bound (Security — Done)

**Origin**: security review of _064 (Wave 37 finding SEC-03, 2026-11-24, CWE-20/CWE-770) — `password_hash` was `text` with no length cap.
**Status**: **Done** (2026-11-24, Phase 6 / `_064`) — added `enrollments_password_hash_length` CHECK constraint (`char_length(password_hash) <= 72`) via `Migration20261124182507`, with the constraint name in `ENROLLMENT_SCHEMA_CONSTRAINT_NAMES` (single source). **Updated 2026-11-25 (Argon2id migration)**: bcrypt was replaced with Argon2id (ADR-043); PHC strings are ~98 chars, so `Migration20261125220000` raised the CHECK to `<= 255` (`PASSWORD_HASH_MAX_LENGTH`).
**Requirement**: (met) Database-level bound on the password hash column.
**Rationale**: Defense-in-depth against future regressions that bypass the application hashing layer.

### 3. Expired-Condition Status Unification (Consistency — Done)

**Origin**: security review of _064 (Wave 37 finding SEC-02, 2026-11-24, CWE-203) + DEFERRED _062 #2 — due-but-unpersisted expiration returned 410 while already-EXPIRED rows returned 409.
**Status**: **Done** (2026-11-24, Phase 6 / `_064`) — `EnrollmentStateMachine.executeStep()` now checks `enrollment.status === ENROLLMENT_STATUS_EXPIRED` explicitly after `expireIfDue()` and throws `EnrollmentStateMachineError` with `ErrorCode.EnrollmentExpired` / `HttpStatus.GONE` (410), so both the just-expired and already-expired paths return the same 410 contract.
**Requirement**: (met) Single representative status code (410 Gone) for the expired condition.
**Rationale**: Eliminates the persistence-state oracle; clients can rely on 410 = expired regardless of when the transition was persisted.

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

### 2. Trust-Proxy Configuration Hardening (SEC-03, 2026-11-25)

**Origin**: code-security-analyzer finding SEC-03 (Low, 2026-11-25) — `docs/judge-findings.md` Argon2id migration security review.
**Status**: **Open** — The current default `trustProxy=true` without a `TRUST_PROXY_PROXIES` allowlist allows IP spoofing via `X-Forwarded-For` header, enabling rate-limit bypass by cycling spoofed valid-looking IPs. The `boundedTracker` in `redis-throttler.guard.ts` only falls back to the socket address when the tracker is not a valid IP.
**Requirement**: For production deployment, `TRUST_PROXY_PROXIES` **must** be set to a strict allowlist of known proxy CIDRs (load balancer, CDN). This is already documented in ADR-032 and the `TRUST_PROXY_PROXIES` env var description in `server.env.ts`. Add a deployment checklist item to `ONBOARDING.md` and verify in CI that the variable is set for non-development environments.
**Rationale**: Without the allowlist, an attacker can bypass per-IP rate limits entirely, amplifying the Argon2id DoS surface (SEC-01) and enabling credential stuffing/OTP brute force.
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

### 3. Fail-closed `APP_ENV` default (SEC-INFO, Wave 26)

**Origin**: code-security-analyzer SEC-01 (informational, CWE-1188, 2026-11-17) — Wave 26 security review of the ADR-038 Phase 1 unit; pre-existing condition, not attacker-reachable.
**Status**: Open — environment-validation behavior decision awaiting developer direction.
**Requirement**: decide whether `APP_ENV` should stop defaulting to `development` (currently `z.enum(AppEnv).default(AppEnv.Development)` in `server.env.ts`): either default to `production` (fail-closed) or add a `superRefine` rule rejecting an unset `APP_ENV` outside development. Today an operator who boots without `APP_ENV` gets a development-gated process — including the publicly served Swagger routes (`/docs`, `/docs/json`, `/docs/yaml`) in an intended-production deployment.
**Rationale**: API-surface disclosure only (the document contains no secrets — e2e-pinned), and no request input reaches the gate; but the development default makes the production posture depend on operator vigilance. Changing a default is an environment-stability decision under the environment-variable rules.

---

**Wave 26 SEC-04 extension (2026-11-17) to "Cache-Control directives for revalidatable responses" (item 2 above)**: the Wave 26 security review confirmed `Vary: Accept-Language` and locale-composed validators defend variant identity today, and added that a 304 should echo the 200's cache directives (RFC 9110 §15.4.5). The policy decision (which directives per response class) is to be fixed when the first authenticated, per-user GET endpoint lands.

### Status update (2026-11-18, developer-directed hardening before the Phase 1 commit)

- **Item 2 (Cache-Control directives) — Done.** The interim policy the item
  awaited is now implemented: every tagged (revalidatable) response carries
  `Cache-Control: private, no-cache` — shared intermediaries never store,
  private caches must revalidate before every reuse — set by the conditional
  interceptor alongside the ETag, never overwriting an explicit per-route
  declaration (the health routes keep `no-store`), and echoed by the 304 per
  RFC 9110 §15.4.5. Documented in ADR-038 Decision 5 and `docs/api.md`. The
  residual forward-looking piece stands: the first authenticated, per-user
  GET endpoint must still define its stricter per-endpoint policy.
- **Item 3 (fail-closed `APP_ENV` default) — Done.** The developer directed
  removing the default: `APP_ENV` is now required (`z.enum(AppEnv)` with no
  default in `server.env.ts`), so an omitted value fails startup instead of
  silently booting a development-gated process. All environments already
  declared it (`.env.development`/`.env.test` variants/`.env.production`,
  injected into both Compose stacks through the app env files);
  `.env.example` documents the requiredness; the ONBOARDING env table
  already described it as required. Validation specs updated to the stricter
  contract.
