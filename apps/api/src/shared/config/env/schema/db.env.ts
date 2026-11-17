import { z } from 'zod';

import { positiveIntegerEnv } from './validation-helpers.js';

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
  // Pool capacity per application instance (ADR-036). Optional with a
  // default that preserves the historical effective capacity (pg-pool's
  // implicit max of 10); sizing is deployment-dependent because the total
  // connection budget is replicas × pool size against PostgreSQL's
  // max_connections. Blank values are treated as unset (the repo-wide
  // convention), so an empty entry in an env file uses the default.
  DATABASE_POOL_MAX: positiveIntegerEnv('DATABASE_POOL_MAX', 10),
});

export type DbEnv = z.infer<typeof dbEnvSchema>;
