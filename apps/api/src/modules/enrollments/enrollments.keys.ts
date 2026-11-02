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
