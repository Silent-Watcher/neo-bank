import { z } from 'zod';

import { positiveSafeInteger } from './validation-helpers.js';

// The OTP is exactly six digits (100000–999999) and is stored in Redis only as
// an HMAC-SHA-256 digest keyed with ENROLLMENTS_OTP_HMAC_SECRET (ADR-018), so a
// Redis read-only compromise does not expose verifiable OTP values.

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

  // Dedicated HMAC-SHA-256 key for OTP digest storage (ADR-018). Required with
  // no default: the application refuses to start when it is missing. Must be
  // exactly 64 hexadecimal characters — 32 bytes of key material once decoded
  // — generated per environment with `openssl rand -hex 32`, identical across
  // all API instances, never logged, and never stored in Redis.
  ENROLLMENTS_OTP_HMAC_SECRET: z
    .string({ error: 'ENROLLMENTS_OTP_HMAC_SECRET must be a string.' })
    .regex(
      /^[0-9a-f]{64}$/i,
      'ENROLLMENTS_OTP_HMAC_SECRET must be exactly 64 hexadecimal characters (32 decoded bytes). Generate one with `openssl rand -hex 32`.',
    ),
});

export type EnrollmentsEnv = z.infer<typeof enrollmentsEnvSchema>;
