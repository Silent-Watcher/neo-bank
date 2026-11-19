import { z } from 'zod';

import { EnvValidationError } from '#errors/env-validation.error.js';
import { dbEnvSchema } from './schema/db.env.js';
import { enrollmentsEnvSchema } from './schema/enrollments.env.js';
import { idempotencyEnvSchema } from './schema/idempotency.env.js';
import { logEnvSchema } from './schema/log.env.js';
import {
  isRecoveryThresholdInvalid,
  memoryProtectionEnvSchema,
} from './schema/memory-protection.env.js';
import { rateLimitEnvSchema } from './schema/rate-limit.env.js';
import { isRedisSocketTimeoutInvalid, redisEnvSchema } from './schema/redis.env.js';
import { isCorsOriginRequiredInProduction, serverEnvSchema } from './schema/server.env.js';

export const envSchema = z
  .object({
    ...serverEnvSchema.shape,
    ...logEnvSchema.shape,
    ...dbEnvSchema.shape,
    ...redisEnvSchema.shape,
    ...rateLimitEnvSchema.shape,
    ...enrollmentsEnvSchema.shape,
    ...idempotencyEnvSchema.shape,
    ...memoryProtectionEnvSchema.shape,
  })
  .superRefine((env, ctx) => {
    if (isCorsOriginRequiredInProduction(env)) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGIN'],
        message: 'CORS_ORIGIN is required when APP_ENV is production.',
      });
    }
    if (isRecoveryThresholdInvalid(env)) {
      ctx.addIssue({
        code: 'custom',
        path: ['MEMORY_PROTECTION_RECOVERY_RSS_MB'],
        message:
          'MEMORY_PROTECTION_RECOVERY_RSS_MB must be lower than MEMORY_PROTECTION_MAX_RSS_MB (hysteresis).',
      });
    }
    if (isRedisSocketTimeoutInvalid(env)) {
      ctx.addIssue({
        code: 'custom',
        path: ['REDIS_SOCKET_TIMEOUT_MS'],
        message:
          'REDIS_SOCKET_TIMEOUT_MS must be greater than REDIS_COMMAND_TIMEOUT_MS (per-command failures must surface before the socket is destroyed).',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    throw new EnvValidationError(z.prettifyError(result.error));
  }

  return result.data;
}

export const _env = validateEnv();
