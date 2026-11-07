import { buildRedisKey } from '#src/shared/redis/redis-keys.js';

/**
 * Redis key for a challenge OTP: `neo-bank:enrollments:challenge:otp:<phone>`
 * (pattern and rules are defined in the root AGENTS.md key-naming rule).
 */
export function challengeOtpKey(phoneNumber: string): string {
  return buildRedisKey({
    module: 'enrollments',
    feature: 'challenge',
    resource: 'otp',
    identifier: phoneNumber,
  });
}

/**
 * Redis key for failed verification attempts: `neo-bank:enrollments:challenge:attempts:<phone>`
 * Shares the same 120-second TTL as the OTP so it expires with the issuance window.
 */
export function challengeAttemptsKey(phoneNumber: string): string {
  return buildRedisKey({
    module: 'enrollments',
    feature: 'challenge',
    resource: 'attempts',
    identifier: phoneNumber,
  });
}

/**
 * Redis key for per-phone OTP send rate limiting: `neo-bank:enrollments:challenge:rate-limit:<phone>`
 * Sorted set with timestamps as scores to track OTP sends within a rolling 60-minute window.
 * TTL is 3600 seconds (60 minutes) so the key expires when no requests are made.
 */
export function challengeRateLimitKey(phoneNumber: string): string {
  return buildRedisKey({
    module: 'enrollments',
    feature: 'challenge',
    resource: 'rate-limit',
    identifier: phoneNumber,
  });
}
