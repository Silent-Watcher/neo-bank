import { z } from 'zod';

import { positiveSafeInteger } from './validation-helpers.js';

// Normalizes whitespace-padded values: trims surrounding whitespace so
// padded credentials or URLs still validate. Follows the
// normalize-then-validate pattern of CORS_ORIGIN.
function trim(value: string): string {
  return value.trim();
}

// Redis connection settings are mandatory: the deployment must always
// provide them. Only malformed values are rejected here; an unreachable
// Redis server is a runtime condition handled with degraded health, not a
// configuration error.
export const redisEnvSchema = z.object({
  REDIS_URL: z
    .string()
    .transform(trim)
    .pipe(
      z.url({
        protocol: /^rediss?$/,
        error: 'REDIS_URL must be a valid Redis URL (redis:// or rediss://).',
      }),
    ),
  REDIS_USERNAME: z.string().transform(trim),
  REDIS_PASSWORD: z.string().transform(trim),
  REDIS_DB: z.coerce
    .number({ error: 'REDIS_DB must be a valid number.' })
    .int('REDIS_DB must be an integer.')
    .min(0, 'REDIS_DB must be between 0 and 15.')
    .max(15, 'REDIS_DB must be between 0 and 15.')
    .optional(),
  // Only the exact strings "true" and "false" are accepted so that no other
  // string is coerced into a truthy value by accident. A rediss:// URL also
  // enables TLS on its own; this variable is for separate hostname/port
  // deployments or to force TLS for a plain redis:// URL.
  REDIS_TLS: z
    .enum(['true', 'false'], { error: 'REDIS_TLS must be exactly "true" or "false".' })
    .default('false')
    .transform((value) => value === 'true'),
  REDIS_CONNECT_TIMEOUT_MS: positiveSafeInteger('REDIS_CONNECT_TIMEOUT_MS').default(10000),
  REDIS_COMMAND_TIMEOUT_MS: positiveSafeInteger('REDIS_COMMAND_TIMEOUT_MS').default(5000),
  // Finite per-request retry budget so commands fail predictably while Redis
  // is unreachable instead of waiting through the (large) ioredis default.
  REDIS_MAX_RETRIES_PER_REQUEST: positiveSafeInteger('REDIS_MAX_RETRIES_PER_REQUEST').default(3),
  REDIS_SHUTDOWN_TIMEOUT_MS: positiveSafeInteger('REDIS_SHUTDOWN_TIMEOUT_MS').default(2000),
});

export type RedisEnv = z.infer<typeof redisEnvSchema>;
