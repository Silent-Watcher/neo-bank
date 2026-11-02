# Enrollments OTP Verification

## User Request

The user asked for a `POST /enrollments/verify` endpoint: Zod validation of
an Iranian phone number (`phone`) and a six-character numeric OTP (`otp`,
never converted to a number) before any Redis access, atomic verification
against the stored code using a Redis Lua script (read, compare, delete in
one execution — no separate GET/DEL), identical generic error responses for
missing, expired, and incorrect OTPs, Swagger documentation that exposes no
internal details, meaningful tests, and permanent root `AGENTS.md` rules for
error-response security and Redis atomicity/Lua scripting.

## Implementation

- **Schemas** (`enrollments.schema.ts`): extracted the shared
  `phoneNumberSchema` (reused by challenge and verify); new
  `verifyRequestSchema` with `phone` and `otp` (exact six-digit numeric
  string; no coercion so leading zeros survive).
- **Atomic Redis operation** (`RedisService.deleteIfEquals(key, value)`):
  one Lua script performs `GET`, comparison with `ARGV[1]`, and `UNLINK` of
  the key in a single execution, returning 1/0; the service maps the reply
  (number or string) to a boolean without type assertions. Uses the standard
  `challengeOtpKey(phone)` — no new namespace.
- **Service**: `verifyChallenge(phone, otp)` consumes the key via
  `deleteIfEquals` and returns `{ phoneNumber }` on success; every failure
  (missing, expired, incorrect) throws the same `AppHttpException` —
  `ErrorCode.OtpVerificationFailed`, generic detail
  "Phone number verification failed.", HTTP 400. Redis failures propagate as
  plain errors, which the global filter already converts to a generic 500
  Problem Details response with internals only in logs.
- **Error contract**: new `OTP_VERIFICATION_FAILED` code mapped to the
  application-error Problem Type family with title "Verification Failed".
- **Swagger**: verify endpoint documents the request schema (from Zod),
  the phone-only success envelope, and the deliberately identical 400
  verification-failure response; 500 documented without internal details.
- **Tests**: schema spec for the verify schema (format, normalization,
  leading zeros, missing fields); service spec (consumption under the
  convention key, single generic error for all failure conditions, Redis
  errors not converted into verification failures); RedisService spec for
  `deleteIfEquals` (single eval call carrying GET/compare/UNLINK, boolean
  mapping, error propagation); e2e (success envelope without the OTP value,
  phone normalization, identical error bodies for incorrect vs missing OTP,
  six invalid-request variants rejected with `BAD_REQUEST` and **no Redis
  call**, generic 500 with `APPLICATION_ERROR` and no internal details);
  swagger e2e path list updated.

## Validation

- `pnpm typecheck` — passed.
- `pnpm test` — 24 files / 178 tests passed.
- `pnpm test:e2e` — 13 files / 62 tests passed.

## Documentation

- Root `AGENTS.md`: new **Error Response Security** section; the Redis
  section became **Redis Conventions** with a new **Atomicity and Lua
  Scripting** subsection (atomic scripts for dependent operations, priority
  for read-check-delete flows, centralized key convention).
- `apps/api/AGENTS.md`: Redis rules extended with the atomic-script rule and
  the generic-verification-failure requirement.
- `apps/api/ONBOARDING.md`, `docs/current-state.md`: verify endpoint,
  atomic consumption, updated test counts.
