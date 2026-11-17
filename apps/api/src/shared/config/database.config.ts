import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';

import { _env } from './env/env.config.js';

export const DATABASE_CONFIG = Symbol('DATABASE_CONFIG');

const databaseConfig = registerAs(DATABASE_CONFIG, () => ({
  // Connection settings are mandatory; an unreachable server is a runtime
  // condition reported through degraded health, not a configuration error
  // (ADR-027: the ORM initializes without a mandatory startup connection).
  url: _env.DATABASE_URL,
  // Pool capacity (ADR-036): deployment-dependent sizing — keep
  // replicas × DATABASE_POOL_MAX plus administrative clients below
  // PostgreSQL max_connections, with headroom reserved for administration.
  poolMax: _env.DATABASE_POOL_MAX,
}));

export default databaseConfig;

export type DatabaseConfig = ConfigType<typeof databaseConfig>;
