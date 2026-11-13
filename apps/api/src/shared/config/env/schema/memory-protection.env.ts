import { z } from 'zod';

import { positiveSafeInteger } from './validation-helpers.js';

// Node timers clamp delays above 2^31-1 ms down to 1 ms, so an unbounded
// interval would silently invert the sampling cadence. One hour is far beyond
// any meaningful observation window for RSS.
const MAX_SAMPLE_INTERVAL_MS = 3_600_000;

// Memory-based load shedding (ADR-026): thresholds are absolute megabytes of
// process RSS so they can be matched directly against a deployment's memory
// limit; the recovery threshold must stay below the activation threshold so
// the protection state cannot oscillate (hysteresis).
export const memoryProtectionEnvSchema = z.object({
  // Only the exact strings "true" and "false" are accepted so that no other
  // string is coerced into a truthy value by accident.
  MEMORY_PROTECTION_ENABLED: z
    .enum(['true', 'false'], {
      error: 'MEMORY_PROTECTION_ENABLED must be exactly "true" or "false".',
    })
    .default('true')
    .transform((value) => value === 'true'),
  MEMORY_PROTECTION_MAX_RSS_MB: positiveSafeInteger('MEMORY_PROTECTION_MAX_RSS_MB').default(1024),
  MEMORY_PROTECTION_RECOVERY_RSS_MB: positiveSafeInteger(
    'MEMORY_PROTECTION_RECOVERY_RSS_MB',
  ).default(768),
  MEMORY_PROTECTION_SAMPLE_INTERVAL_MS: positiveSafeInteger('MEMORY_PROTECTION_SAMPLE_INTERVAL_MS')
    .max(
      MAX_SAMPLE_INTERVAL_MS,
      `MEMORY_PROTECTION_SAMPLE_INTERVAL_MS must be at most ${MAX_SAMPLE_INTERVAL_MS} (1 hour; Node timers clamp larger delays to 1 ms).`,
    )
    .default(5000),
  MEMORY_PROTECTION_STABLE_SAMPLES: positiveSafeInteger('MEMORY_PROTECTION_STABLE_SAMPLES').default(
    3,
  ),
});

export type MemoryProtectionEnv = z.infer<typeof memoryProtectionEnvSchema>;

// Aggregate-level cross-field rule (evaluated in env.config.ts superRefine,
// because merging `.shape` into the aggregate schema drops sub-schema
// refinements). Kept next to the schema so the invariant lives with the
// fields it guards.
export function isRecoveryThresholdInvalid(env: {
  MEMORY_PROTECTION_MAX_RSS_MB: number;
  MEMORY_PROTECTION_RECOVERY_RSS_MB: number;
}): boolean {
  return env.MEMORY_PROTECTION_RECOVERY_RSS_MB >= env.MEMORY_PROTECTION_MAX_RSS_MB;
}
