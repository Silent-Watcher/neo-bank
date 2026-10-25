import { z } from 'zod';

import { EnvValidationError } from '../../errors/env-validation.error.js';
import { isCorsOriginRequiredInProduction, serverEnvSchema } from './schema/server.env.js';

export const envSchema = z
  .object({
    ...serverEnvSchema.shape,
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
