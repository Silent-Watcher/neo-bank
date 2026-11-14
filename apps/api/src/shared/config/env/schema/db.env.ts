import { z } from 'zod';

// Database connection settings are mandatory: the deployment must always
// provide them. Only malformed values are rejected here; an unreachable
// PostgreSQL server is a runtime condition handled with degraded health
// (ADR-027), not a configuration error.
export const dbEnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .transform((value: string) => value.trim())
    .pipe(
      z.url({
        protocol: /^postgres(ql)?$/,
        error: 'DATABASE_URL must be a valid PostgreSQL URL (postgres:// or postgresql://).',
      }),
    ),
});

export type DbEnv = z.infer<typeof dbEnvSchema>;
