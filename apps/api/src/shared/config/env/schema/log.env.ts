import { z } from 'zod';

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

const DEFAULT_LOG_LEVEL: LogLevel = 'info';

export const logEnvSchema = z.object({
  LOG_LEVEL: z
    .enum(LOG_LEVELS, {
      error: `LOG_LEVEL must be one of: ${LOG_LEVELS.join(', ')}.`,
    })
    .default(DEFAULT_LOG_LEVEL),
});

export type LogEnv = z.infer<typeof logEnvSchema>;
