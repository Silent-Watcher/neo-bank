import { z } from 'zod';

// The idempotency scope secret keys the HMAC-SHA-256 that pseudonymizes the
// normalized phone number into the idempotency scope (ADR-039). It must stay
// independent from ENROLLMENTS_OTP_HMAC_SECRET so a compromise of one secret
// does not expose the other mechanism.
export const idempotencyEnvSchema = z.object({
  // Dedicated HMAC-SHA-256 key for the idempotency scope (ADR-039). Required
  // with no default: the application refuses to start when it is missing.
  // Must be exactly 64 hexadecimal characters — 32 bytes of key material once
  // decoded — generated per environment with `openssl rand -hex 32`, identical
  // across all API instances sharing the same Redis idempotency store, never
  // logged, and never returned by the API.
  IDEMPOTENCY_SCOPE_SECRET: z
    .string({ error: 'IDEMPOTENCY_SCOPE_SECRET must be a string.' })
    .regex(
      /^[0-9a-f]{64}$/i,
      'IDEMPOTENCY_SCOPE_SECRET must be exactly 64 hexadecimal characters (32 decoded bytes). Generate one with `openssl rand -hex 32`.',
    ),
});

export type IdempotencyEnv = z.infer<typeof idempotencyEnvSchema>;
