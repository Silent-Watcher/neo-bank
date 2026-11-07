import { z } from 'zod';

// The OTP is exactly six digits (100000–999999). An unsalted hash would not
// meaningfully resist offline brute force; the attempt limit is the primary
// protection. Hashing is deferred (DEFERRED.md).
function positiveSafeInteger(field: string) {
  return z.coerce
    .number({ error: `${field} must be a valid number.` })
    .int(`${field} must be an integer.`)
    .positive(`${field} must be positive.`)
    .refine((value) => Number.isSafeInteger(value), {
      message: `${field} must be within the safe integer range.`,
    });
}

export const enrollmentsEnvSchema = z.object({
  // Maximum failed OTP verification attempts allowed during a single 120-second
  // validity window. When exceeded, the active OTP is invalidated and the
  // client must wait for the lockout window to expire before requesting a new one.
  ENROLLMENTS_MAX_VERIFY_ATTEMPTS: positiveSafeInteger('ENROLLMENTS_MAX_VERIFY_ATTEMPTS').default(
    5,
  ),

  // Lockout window in seconds after max verification attempts are exceeded.
  // During this window, both OTP issuance and verification are rejected for the phone number.
  // Independent of the 120-second OTP TTL. Default: 900s (15 minutes).
  ENROLLMENTS_LOCKOUT_TTL_SECONDS: positiveSafeInteger('ENROLLMENTS_LOCKOUT_TTL_SECONDS').default(
    900,
  ),
});

export type EnrollmentsEnv = z.infer<typeof enrollmentsEnvSchema>;
