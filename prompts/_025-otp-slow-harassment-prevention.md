# OTP Slow Harassment Prevention in Enrollment Module

## User Request

Enhance the existing OTP request flow in the `enrollment` module to prevent OTP slow harassment attacks. The current OTP flow has a 120-second cooldown but an attacker can wait for the cooldown to expire and repeatedly request OTPs, or rotate IP addresses to bypass IP-based rate limiting.

Requirements:

- Maximum 5 OTP sends per phone number within any rolling 60-minute window
- Keep the existing 120-second cooldown between OTP requests
- Keep the existing IP-based rate limiter (complement, not replace)
- Different IP addresses must not allow an attacker to bypass the per-phone restriction

Expected behavior:

1. If an OTP has already been sent and the 120-second cooldown has not expired, do not send another OTP
2. Once the cooldown expires, allow another OTP request only if the phone number has not reached its hourly limit
3. After 5 OTP sends within a rolling 60-minute window, reject further OTP requests until an earlier entry expires from that window
4. The restriction must be applied independently for each normalized phone number

Implementation constraints:

- Use Redis to maintain the per-phone hourly request limit
- Introduce minimum additional Redis key(s) following existing key naming conventions
- Lua scripts mandatory for atomicity
- Prevent race conditions when multiple requests for the same phone arrive concurrently
- Preserve existing cooldown - must remain effective for full 120 seconds
- A successful OTP verification or any other operation must not accidentally delete, shorten, or reset the cooldown
- The hourly restriction must remain effective independently of the OTP challenge key's lifecycle
- Do not expose internal rate-limit details that could help an attacker bypass the restriction

## Implementation

### 1. Error Code

Added new `ErrorCode.OtpRateLimitExceeded` in `src/shared/errors/error.code.ts` with the application-error Problem Type family and title "Too Many Requests".

### 2. Redis Key

Added new key function in `src/modules/enrollments/enrollments.keys.ts`:

- `challengeRateLimitKey(phoneNumber)` → `neo-bank:enrollments:challenge:rate-limit:<phone>`
- Uses a sorted set with timestamps as scores for rolling window tracking
- TTL: 3600 seconds (60 minutes), auto-expires when no requests are made

### 3. Lua Script in RedisService

Added atomic `CHECK_OTP_RATE_LIMIT_SCRIPT` in `src/shared/redis/redis.service.ts`:

- Single Lua execution for atomic check-and-increment
- Removes expired entries (> 60 min ago) using `ZREMRANGEBYSCORE`
- Counts remaining entries with `ZCARD`
- If count >= 5, returns 0 (rate limit exceeded)
- Otherwise, adds new entry with unique member (timestamp + random suffix), sets TTL, returns 1

Added `checkOtpRateLimit()` method that invokes the script with parameters:

- `rateLimitKey`: the sorted set key
- `maxSends`: 5 (default)
- `windowMinutes`: 60 (default)

### 4. EnrollmentsService

Updated `requestChallenge()` in `src/modules/enrollments/enrollments.service.ts`:

- First checks hourly rate limit via `redisService.checkOtpRateLimit()`
- If limit exceeded, throws `AppHttpException` with `ErrorCode.OtpRateLimitExceeded` and generic detail "Too many OTP requests. Please try again later."
- Then proceeds with existing 120-second cooldown check via `setNxEx`
- Constants: `MAX_OTP_SENDS_PER_HOUR = 5`, `OTP_RATE_LIMIT_DETAIL` (generic message)

### 5. EnrollmentsController Swagger Docs

Added new 400 response documentation for `OTP_RATE_LIMIT_EXCEEDED` error with generic message that doesn't expose internal limit details.

### 6. Tests

**Unit tests** (`enrollments.service.spec.ts`):

- Checks rate limit is called before storing OTP
- Rejects when hourly limit exceeded
- Propagates Redis rate limit check failures
- All 13 tests pass

**E2E tests** (`test/enrollments.e2e-spec.ts`):

- Validates phone number, stores OTP, checks rate limit key with correct params
- Stores OTP under normalized phone number (+98)
- Rejects invalid phone numbers
- Serves 500 when OTP storage fails
- Serves generic 400 when hourly OTP rate limit exceeded (no internal details exposed)
- Serves generic 500 when rate limit check fails
- All 11 tests pass

**Redis integration tests** (`test/enrollments-check-otp-rate-limit.redis-spec.ts`):

- Allows first OTP send and stores timestamp entry
- Allows up to 5 OTP sends within window
- Rejects 6th OTP send within rolling 60-minute window
- Allows send after expired entry removed from window
- Different phone numbers have independent limits
- Concurrent requests for same phone cannot exceed limit (tested 10 concurrent → 5 allowed, 5 rejected)
- Failed/rejected requests do not consume quota
- Expired entries removed before counting (rolling window)
- Handles Redis errors gracefully
- All 9 tests pass

## Redis Key Strategy

- **OTP key**: `neo-bank:enrollments:challenge:otp:<phone>` - 120s TTL, SET NX EX for cooldown
- **Rate limit key**: `neo-bank:enrollments:challenge:rate-limit:<phone>` - sorted set, 3600s TTL, rolling 60-min window
- Both keys use the centralized `buildRedisKey` with `neo-bank` root namespace
- Keys are independent: OTP key lifecycle doesn't affect rate limit key and vice versa

## How Lua Guarantees Atomicity

The `CHECK_OTP_RATE_LIMIT_SCRIPT` executes as a single atomic operation:

1. `ZREMRANGEBYSCORE` - removes all entries older than 60 minutes
2. `ZCARD` - counts remaining entries in window
3. Comparison: if count >= maxSends, returns 0 immediately
4. `ZADD` - adds new entry with current timestamp as score
5. `EXPIRE` - refreshes key TTL to 3600 seconds

This prevents race conditions where concurrent requests could all read the same count before any writes occur.

## Verification

All checks pass:

- `pnpm format` — clean
- `pnpm lint` — only pre-existing warnings (no new errors)
- `pnpm typecheck` — passed
- `pnpm test` — 26 files, 201 tests passed
- `pnpm test:e2e` (enrollments) — 11 tests passed
- `pnpm test:redis` (enrollments rate limit) — 9 tests passed

## Assumptions and Limitations

1. The implementation uses a sorted set with millisecond timestamps for rolling window accuracy. The unique member format `timestamp:random` ensures no collisions.

2. The generic error message "Too many OTP requests. Please try again later." is used for both the hourly limit and the 120-second cooldown, preventing attackers from distinguishing between them.

3. The IP-based rate limiter (`@Throttle({ short: { limit: 2, ttl: seconds(120) } })`) remains active and complementary.

4. Successful OTP verification deletes the OTP key and attempts key but NOT the rate limit key, preserving the hourly quota independently.

5. The rate limit key auto-expires after 60 minutes of inactivity, cleaning up unused phone numbers.

6. The existing cooldown (120s TTL on OTP key) is completely independent from the hourly limit (sorted set with 3600s TTL). Neither can bypass the other.
