import { z } from 'zod';

import { EnvValidationError } from '../../errors/env-validation.error.js';
import { serverEnvSchema } from './schema/server.env.js';

export const envSchema = z.object({
  ...serverEnvSchema.shape,
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
