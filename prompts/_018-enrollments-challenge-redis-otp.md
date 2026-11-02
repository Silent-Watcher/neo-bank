# Enrollments Challenge & Redis OTP

## User Request

The user asked to update the OTP functionality in the `enrollments` module:
rename `POST /enrollments/otp` to `POST /enrollments/challenge`; validate the
Iranian phone number, generate a six-digit OTP, store it in Redis with an
exact 120-second TTL, and return only the phone number (never the OTP; no
SMS). The existing Redis module must be reused. A hierarchical Redis key
naming convention (`<app>:<module>:<feature>:<resource>:<identifier>`, e.g.
`neo-bank:enrollments:challenge:otp:<phone>`) must be established with a
centralized mechanism and added as a permanent rule to the root `AGENTS.md`.
Swagger docs must reflect the new behavior, and tests must cover only
current functionality (no deprecation tests).

## Implementation

- **Key convention** (`src/shared/redis/redis-keys.ts`): `buildRedisKey`
  builder with the centrally fixed root namespace `neo-bank`; the pattern,
  rules, and "one co-located keys file per feature" requirement are now a
  root `AGENTS.md` rule. The enrollments module defines its keys in
  `enrollments.keys.ts` (`challengeOtpKey(phone)`).
- **Service**: `EnrollmentsService.requestChallenge(phoneNumber)` generates
  the OTP with `crypto.randomInt(100000, 1000000)`, stores it through the
  existing `RedisService.set(key, otp, { ttlSeconds: 120 })` (constant
  `CHALLENGE_OTP_TTL_SECONDS = 120`), and returns `{ phoneNumber }` only.
  Redis failures propagate to the global Problem Details filter (500).
- **Endpoint**: `POST /api/v1/enrollments/challenge`; schema exports renamed
  to `challengeRequestSchema`/`ChallengeRequestBody` (validation and
  normalization unchanged).
- **Swagger**: operation describes normalization, generation, Redis storage
  with 120s expiry, and that the OTP value is never returned and no SMS is
  sent; the 200 envelope schema contains only `phoneNumber`; a 500 Problem
  Details response documents Redis storage failures.
- **Tests**: service spec (key follows the convention, exact 120s TTL,
  six-digit OTP over the full range, secure `randomInt` usage, phone-only
  response, Redis failure propagation); controller spec (delegation);
  e2e suite updated to override `RedisService` and assert the exact key
  `neo-bank:enrollments:challenge:otp:09123456789`, TTL 120, six-digit
  stored value, phone-only envelope, +98 normalization, 400 validation
  Problem Details, and 500 Problem Details when storage fails. The swagger
  e2e spec asserts the new path and that the OTP value appears nowhere in
  the generated document. No old-behavior/deprecation tests were written.

## Validation

- `pnpm typecheck` — passed.
- `pnpm test` — 24 files / 167 tests passed.
- `pnpm test:e2e` — 13 files / 57 tests passed.

## Documentation

- Root `AGENTS.md`: new "Redis Key Naming Convention" section (fixed
  hierarchical pattern, lowercase/kebab-case segments, central root
  namespace, ownership-reflecting segments, no scattered hardcoded strings).
- `apps/api/AGENTS.md`: Redis rules reference the convention, the shared
  builder, and the per-feature keys file; directory structure updated.
- `apps/api/ONBOARDING.md` and `docs/current-state.md`: challenge behavior,
  Redis as the first real consumer, updated test counts.
- `docs/architecture.md`: enrollments challenge named as the first Redis
  consumer.
