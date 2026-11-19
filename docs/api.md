# API Reference

This is the human-readable reference of the Neo Bank HTTP API. The route
inventory was extracted with `nestbruno` 0.7.0 (static analysis, 2026-11-15,
`complete: true`, no diagnostics) and verified against the source. NestBruno
extracts routes, parameters, and request-body field names; response shapes,
error semantics, rate limits, and guards below come from the controllers,
services, and bootstrap source (referenced per section). The always-current
machine-readable contract is the OpenAPI document served by the API itself in
development (`/docs/json`); this page must not contradict it.

## Base paths

The API binds to the required `HOST`/`PORT` environment variables (no
defaults); the documented development port is **3001**.

| Surface         | Base path | Notes                                                                                                                                |
| --------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Versioned API   | `/api/v1` | Global prefix `api` + URI versioning `v1` (`apps/api/src/main.ts:23-25,70-77`, ADR-005/007)                                          |
| Version-neutral | —         | `/health`, `/health/ready`, `/problems/application-error` are excluded from the prefix and versioning (`apps/api/src/main.ts:70-76`) |

NestBruno note: the prefix and default version are applied via constants, not
string literals, so the analyzer could not prove them statically (two
warnings in its diagnostics); the values above are taken from
`apps/api/src/main.ts`.

## Conventions

All versioned endpoints follow the application-global contracts:

- **Success envelope** (ADR-011) — every JSON success response is wrapped:
  `{ timestamp, apiVersion, requestId, status, message, data }`, where
  `status` is the HTTP status code (integer) and `message` is localized.
  HEAD, 204/304, SSE, streams, non-JSON content types, and handler payloads
  with no JSON representation (the challenge endpoint deliberately answers an
  empty body — see its section) are not wrapped.
- **Errors** (ADR-010) — RFC 9457 Problem Details, `application/problem+json`,
  `type: /problems/application-error`, with extension members `code`,
  `timestamp`, `apiVersion`, `requestId`. Clients must rely on `code`, never
  on `title`/`detail`. The Problem Type page is served at
  `GET /problems/application-error`.
- **Request correlation** (ADR-010) — an inbound `x-request-id` header is
  accepted only as a valid UUIDv4; every response echoes `x-request-id`.
- **Localization** (ADR-021) — `Accept-Language: en` (default) or `fa`;
  responses carry `Content-Language` and `Vary: Accept-Language`.
- **Conditional requests** (ADR-032, ADR-038) — every JSON success response
  carries a weak `ETag` (`W/"<sha256>"` over the application payload and the
  resolved response locale) and an explicit
  `Cache-Control: private, no-cache` (shared intermediaries never store;
  private caches must revalidate before reuse; explicit per-route
  declarations, e.g. the health routes' `no-store`, win). **Revalidation is
  opt-in**: a GET route decorated with `@ConditionalGet()` answers a
  matching `If-None-Match` with `304 Not Modified`, bodyless, echoing the
  current `ETag` and cache directives. `If-None-Match` is parsed strictly
  per RFC 9110: one or more entity tags compared weakly (the `W/` prefix is
  ignored; opaque tags compare case-sensitively), `*` matches any current
  representation only as the entire field value, and malformed values are
  ignored. Undecorated GET routes, HEAD, other methods, error responses, and
  redirects never produce a 304. The development Swagger document documents
  the parameter and the 304 response only for decorator-marked
  JSON-success GET operations. Swagger UI renders the bodyless `304` as
  `Error: Not Modified` in its response pane — a client-side artifact of how
  swagger-client surfaces every bodyless non-2xx response (anything outside
  200–299 is treated as a failed response, and with no body to display the
  HTTP reason phrase is shown instead). It is cosmetic: the response itself
  is RFC-compliant, as tools like curl and Postman show.
- **Authentication** — none implemented yet.
- **Idempotency** (ADR-039) — endpoints decorated with `@Idempotent()` require
  an `Idempotency-Key` header (1–255 printable ASCII characters) identifying
  the logical operation. A missing or malformed key is rejected `400`
  (`IDEMPOTENCY_KEY_REQUIRED` / `IDEMPOTENCY_KEY_INVALID`); a concurrent
  duplicate with the same key gets `409 IDEMPOTENCY_KEY_IN_USE` with a
  `Retry-After` hint; a key already used for a different request in the same
  scope gets `422 IDEMPOTENCY_KEY_REUSED`. A completed request replayed with
  the same key returns the stored response unchanged plus an
  `Idempotent-Replayed: true` header and consumes no rate-limit quota.
  Client contract: generate a new key for every new logical operation and
  reuse exactly the same key for its retries. `Idempotent-Replayed` and
  `Retry-After` are CORS-exposed when CORS is enabled.
- **Rate limiting** (ADR-015) — per-IP: 10 requests/second (short) and
  100 requests/minute (long) on all non-exempt routes. Exceeding the limit
  yields `429 Too Many Requests` as Problem Details. Routes marked
  `@DeferredRateLimit()` (currently the challenge endpoint, ADR-039) are
  skipped by the global guard and re-enforced by a route-level interceptor
  that runs after the idempotency gate, so idempotent replays and in-flight
  duplicates never consume quota.
- **Memory protection** (ADR-026) — while memory load shedding is active,
  non-exempt requests are rejected with `503` Problem Details
  (`SERVICE_UNAVAILABLE`) and a `Retry-After` header. Liveness, readiness,
  and the Problem Type page are exempt.

## Endpoints

| Method | Path                            | Controller              | Handler            | Purpose                  |
| ------ | ------------------------------- | ----------------------- | ------------------ | ------------------------ |
| GET    | `/api/v1`                       | `AppController`         | `getHello`         | Smoke-check greeting     |
| POST   | `/api/v1/enrollments/challenge` | `EnrollmentsController` | `requestChallenge` | Issue an enrollment OTP  |
| POST   | `/api/v1/enrollments/verify`    | `EnrollmentsController` | `verify`           | Verify the OTP           |
| GET    | `/health`                       | `HealthController`      | `check`            | Liveness probe           |
| GET    | `/health/ready`                 | `HealthController`      | `checkReady`       | Readiness probe          |
| GET    | `/problems/application-error`   | `ProblemsController`    | `applicationError` | Problem Type page (HTML) |

Source inventory: `nestbruno routes --format json` (6 routes,
`complete: true`, no diagnostics). Development only (`APP_ENV=development`):
Swagger UI at `/docs`, documents at `/docs/json` and `/docs/yaml` (ADR-014) —
these are not part of the production API surface.

---

### GET `/api/v1`

Application greeting. Simple smoke-check under the versioned surface.

- **Response `200`** — envelope, `data` is a string greeting
  (`apps/api/src/modules/app/app.controller.ts`).

### POST `/api/v1/enrollments/challenge`

Issues a six-digit OTP for a phone number. The endpoint is idempotent
(ADR-039). The OTP value is never returned and no SMS is sent yet (delivery
not implemented).

- **Request headers**: `Idempotency-Key` (required) — string, 1–255 printable
  ASCII characters, identifying the logical challenge operation. Client
  contract: generate a new random key for every new challenge request and
  reuse exactly the same key for retries of that operation; a new
  intentional request must use a new key.
- **Request body** (JSON): `{ "phoneNumber": "09121234567" }`
  - `phoneNumber` — string; normalized before validation: surrounding
    whitespace trimmed; `+98` / `0098` / `98` prefixes and a missing leading
    zero folded to `09XXXXXXXXX`; validated against `^09\d{9}$`
    (`apps/api/src/modules/enrollments/enrollments.schema.ts`). The response
    uses the normalized form.
- **Response `202`** — intentionally **empty body**: no envelope and no
  phone number. Challenge accepted and the OTP stored in Redis.
- **Replay** — a retry with the same `Idempotency-Key` after completion
  returns the identical empty `202` with an `Idempotent-Replayed: true`
  header, without executing the handler again or consuming rate-limit quota.
  A concurrent duplicate while the first request is still in flight gets
  `409` (see Errors); it also consumes no quota. A replayed **stored error**
  (a deterministic 4xx from the original execution) keeps that execution's
  `code`, `type`, and localized `title`; its `detail` is the string
  localized when the error was first thrown, so a retry in another locale
  gets the original locale's detail text while the title still localizes.
- **Errors**
  - `400` — missing `Idempotency-Key` (`IDEMPOTENCY_KEY_REQUIRED`) or a
    malformed one (not 1–255 printable ASCII, `IDEMPOTENCY_KEY_INVALID`);
    Problem Details.
  - `400` — phone failed validation (Problem Details).
  - `400` — per-phone hourly quota exceeded (5 sends / rolling 60 minutes)
    or a verification lockout is active: `OTP_RATE_LIMIT_EXCEEDED` with a
    generic message. The quota, cooldown, and lockout are deliberately
    indistinguishable to clients (`apps/api/src/modules/enrollments/enrollments.service.ts`).
  - `400` — an unexpired challenge already exists (`OTP_VERIFICATION_FAILED`).
  - `409` — a request with the same `Idempotency-Key` is still being
    processed (`IDEMPOTENCY_KEY_IN_USE`); carries a `Retry-After` hint (1 s)
    and the duplicate consumes no rate-limit quota.
  - `422` — the `Idempotency-Key` was already used for a different request
    in the same scope (`IDEMPOTENCY_KEY_REUSED`); a new logical operation
    requires a new key. Documented as contract; on this endpoint it is
    structurally unreachable because the idempotency scope and the
    fingerprint both derive from the same normalized phone (ADR-039).
  - `429` — per-IP throttle: endpoint limit 2 requests/120 s on top of the
    global limits (ADR-015). A 429 is **never stored** as an idempotency
    result: the key is released and a retry with the same `Idempotency-Key`
    after the rate-limit window executes normally (ADR-039).
  - `500` — the OTP could not be stored in Redis, or the idempotency store
    is unavailable (fail-closed; a store-selection diagnostic is logged
    internally only).
  - `503` — memory protection active (ADR-026).
- **Behavior** — cryptographically random OTP (100000–999999); only its
  HMAC-SHA-256 digest, bound to a per-issuance challenge ID, is stored in
  Redis with an exact 120-second TTL; issuance is atomic and never happens
  while a lockout is active (ADR-018/019). The idempotency scope and
  fingerprint derive from the normalized phone: equivalent spellings
  (`+98`, `0098`, `98`, missing leading zero) of the same number share one
  scope, so retries across spellings replay instead of colliding, and no
  plain phone number ever reaches a Redis key (the record identifier is a
  SHA-256 digest). Completed results are replayable for 24 hours.

### POST `/api/v1/enrollments/verify`

Verifies a six-digit OTP previously issued for the phone number. On success
the stored code is consumed.

- **Request body** (JSON): `{ "phoneNumber": "09121234567", "otp": "123456" }`
  - `phoneNumber` — same normalization and validation as challenge.
  - `otp` — exact six-character numeric string (`^\d{6}$`); never coerced to
    a number, leading zeros are significant.
- **Response `200`** — envelope, `data`: `{ "phoneNumber": "09121234567" }`.
- **Errors**
  - `400` — verification failed: `OTP_VERIFICATION_FAILED`, identical for a
    missing, expired, incorrect, or exhausted-attempt OTP
    (`apps/api/src/modules/enrollments/enrollments.service.ts`).
  - `429` — per-IP throttle: endpoint limit 5 requests/120 s on top of the
    global limits (ADR-015).
  - `503` — memory protection active (ADR-026).
- **Behavior** — the submitted OTP's HMAC digest is compared with
  `crypto.timingSafeEqual`; consumption and attempt counting resolve
  atomically via a Lua script. Failed attempts are counted up to
  `ENROLLMENTS_MAX_VERIFY_ATTEMPTS` (default 5); when reached, a lockout
  blocks verification and new OTP issuance for `ENROLLMENTS_LOCKOUT_TTL_SECONDS`
  (default 900 s / 15 min). The lockout cannot be bypassed by requesting a
  new OTP. Verification without a live challenge creates no attempt state.

### GET `/health`

Liveness probe. Version-neutral, outside the prefix, unthrottled, exempt
from memory protection. Deliberately independent of memory-protection state.

- **Response `200`** — envelope with Terminus payload `status: ok` or
  `degraded` (Redis or PostgreSQL unreachable — HTTP stays 200 so the
  process never looks dead), plus `info`/`error`/`details` per indicator
  (`apps/api/src/modules/app/health.controller.ts`).
- **Response `503`** — a critical indicator failed (overall status `error`),
  as Problem Details.

### GET `/health/ready`

Readiness probe (ADR-026). Version-neutral, outside the prefix, unthrottled,
exempt from memory protection.

- **Response `200`** — all readiness indicators up: strict Redis, strict
  PostgreSQL, and memory (down while memory protection is active).
- **Response `503`** — any indicator down; orchestrators stop routing traffic
  to the instance. Liveness reports the same outages as `degraded` (200) on
  purpose.

### GET `/problems/application-error`

Human-readable HTML description of the `application-error` Problem Type
referenced by the `type` member of error responses. Version-neutral and
prefix-excluded so the URI stays stable across API versions. Serves
`text/html; charset=utf-8`; not wrapped in the response envelope
(`apps/api/src/modules/app/problems.controller.ts`).

## Analysis notes

- NestBruno inventory: 6 routes, `complete: true`, no diagnostics on
  `routes`; the two `explain` warnings concern the global prefix and default
  version (applied via constants, see Base paths).
- NestBruno resolves request-body **field names only** (not types, defaults,
  or validation rules); field types, patterns, and normalization above come
  from the Zod schemas (`apps/api/src/modules/enrollments/enrollments.schema.ts`).
- Guards, throttling, response envelopes, and error semantics are not
  derivable from static route metadata; they are documented from source
  (`enrollments.controller.ts`, `enrollments.service.ts`,
  `enrollments.idempotency.ts`, `main.ts`,
  ADR-010/011/015/018/019/026/039).
- No authentication exists; no endpoint requires or documents credentials.
