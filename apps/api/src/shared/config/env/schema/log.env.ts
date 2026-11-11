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
  // Optional explicit pretty-printing override. Unset keeps the default
  // behavior (pretty in development only); "true"/"false" forces either
  // format so a containerized API can emit structured JSON for centralized
  // log collection while host-side development stays pretty.
  LOG_PRETTY: z
    .enum(['true', 'false'], {
      error: 'LOG_PRETTY must be exactly "true" or "false".',
    })
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
});

export type LogEnv = z.infer<typeof logEnvSchema>;
