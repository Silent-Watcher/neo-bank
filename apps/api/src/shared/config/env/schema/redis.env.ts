import { z } from 'zod';

import { positiveIntegerEnv } from './validation-helpers.js';

// Normalizes whitespace-padded values: trims surrounding whitespace so
// padded credentials or URLs still validate. Follows the
// normalize-then-validate pattern of CORS_ORIGIN.
function trim(value: string): string {
  return value.trim();
}

// Redis connection settings are mandatory: the deployment must always
// provide them. Only malformed values are rejected here; an unreachable
// Redis server is a runtime condition handled with degraded health, not a
// configuration error. Numeric variables use the blank-tolerant helper: an
// empty entry in an env file applies the documented default instead of
// coercing to an invalid value.
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
  REDIS_CONNECT_TIMEOUT_MS: positiveIntegerEnv('REDIS_CONNECT_TIMEOUT_MS', 10000),
  REDIS_COMMAND_TIMEOUT_MS: positiveIntegerEnv('REDIS_COMMAND_TIMEOUT_MS', 5000),
  // Socket inactivity deadline while commands are in flight (ADR-037): the
  // black-hole recovery bound — a silent socket is destroyed and the bounded
  // reconnect cycle takes over. Must stay above the command timeout so
  // per-command failures surface first (cross-field rule in env.config.ts).
  REDIS_SOCKET_TIMEOUT_MS: positiveIntegerEnv('REDIS_SOCKET_TIMEOUT_MS', 6000),
  // Finite per-request retry budget so commands fail predictably while Redis
  // is unreachable instead of waiting through the (large) ioredis default.
  REDIS_MAX_RETRIES_PER_REQUEST: positiveIntegerEnv('REDIS_MAX_RETRIES_PER_REQUEST', 3),
  REDIS_SHUTDOWN_TIMEOUT_MS: positiveIntegerEnv('REDIS_SHUTDOWN_TIMEOUT_MS', 2000),
});

export type RedisEnv = z.infer<typeof redisEnvSchema>;

/**
 * Cross-field rule (ADR-037): the socket inactivity deadline must stay above
 * the per-command timeout so per-command failures surface before the socket
 * is destroyed. An inverted pair would destroy healthy connections mid-flight
 * against a merely slow Redis, producing constant reconnect churn.
 */
export function isRedisSocketTimeoutInvalid(env: {
  REDIS_COMMAND_TIMEOUT_MS: number;
  REDIS_SOCKET_TIMEOUT_MS: number;
}): boolean {
  return env.REDIS_SOCKET_TIMEOUT_MS <= env.REDIS_COMMAND_TIMEOUT_MS;
}
