import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';

import { _env } from './env/env.config.js';

export const REDIS_CONFIG = Symbol('REDIS_CONFIG');

const redisConfig = registerAs(REDIS_CONFIG, () => ({
  // Connection settings are mandatory; an unreachable server is a runtime
  // condition reported through degraded health, not a configuration error.
  url: _env.REDIS_URL,
  username: _env.REDIS_USERNAME,
  password: _env.REDIS_PASSWORD,
  db: _env.REDIS_DB,
  tls: _env.REDIS_TLS,
  connectTimeoutMs: _env.REDIS_CONNECT_TIMEOUT_MS,
  commandTimeoutMs: _env.REDIS_COMMAND_TIMEOUT_MS,
  maxRetriesPerRequest: _env.REDIS_MAX_RETRIES_PER_REQUEST,
  shutdownTimeoutMs: _env.REDIS_SHUTDOWN_TIMEOUT_MS,
}));

export default redisConfig;

export type RedisConfig = ConfigType<typeof redisConfig>;
