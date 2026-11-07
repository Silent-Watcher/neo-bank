import { z } from 'zod';

import { EnvValidationError } from '#errors/env-validation.error.js';
import { enrollmentsEnvSchema } from './schema/enrollments.env.js';
import { logEnvSchema } from './schema/log.env.js';
import { rateLimitEnvSchema } from './schema/rate-limit.env.js';
import { redisEnvSchema } from './schema/redis.env.js';
import { isCorsOriginRequiredInProduction, serverEnvSchema } from './schema/server.env.js';

export const envSchema = z
  .object({
    ...serverEnvSchema.shape,
    ...logEnvSchema.shape,
    ...redisEnvSchema.shape,
    ...rateLimitEnvSchema.shape,
    ...enrollmentsEnvSchema.shape,
  })
  .superRefine((env, ctx) => {
    if (isCorsOriginRequiredInProduction(env)) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGIN'],
        message: 'CORS_ORIGIN is required when APP_ENV is production.',
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
