import { z } from 'zod';

// Rate-limit counters must stay positive so the Redis storage never receives
// a zero or negative duration as an expiration argument, and bounded by the
// JavaScript safe integer range so millisecond conversions cannot overflow.
function positiveSafeInteger(field: string) {
  return z.coerce
    .number({ error: `${field} must be a valid number.` })
    .int(`${field} must be an integer.`)
    .positive(`${field} must be positive.`)
    .refine((value) => Number.isSafeInteger(value), {
      message: `${field} must be within the safe integer range.`,
    });
}

export const rateLimitEnvSchema = z.object({
  RATE_LIMIT_SHORT_LIMIT: positiveSafeInteger('RATE_LIMIT_SHORT_LIMIT').default(10),
  RATE_LIMIT_SHORT_TTL_SECONDS: positiveSafeInteger('RATE_LIMIT_SHORT_TTL_SECONDS').default(1),
  RATE_LIMIT_LONG_LIMIT: positiveSafeInteger('RATE_LIMIT_LONG_LIMIT').default(100),
  RATE_LIMIT_LONG_TTL_MINUTES: positiveSafeInteger('RATE_LIMIT_LONG_TTL_MINUTES').default(1),
});

export type RateLimitEnv = z.infer<typeof rateLimitEnvSchema>;
