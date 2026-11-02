import type { RedisOptions } from 'ioredis';

import type { RedisConfig } from '#config/redis.config.js';

// Connection retry budget: capped exponential backoff with jitter. The delay
// grows exponentially from the base up to the cap, so a down Redis is probed
// less and less aggressively (no retry storm) while still allowing the
// application to recover without a restart. Retrying indefinitely is
// intentional: reconnection is owned by the client's background strategy,
// never by awaiting it during startup.
const RETRY_BASE_DELAY_MS = 200;
const RETRY_MAX_DELAY_MS = 30000;
const RETRY_JITTER_MS = 100;

export function redisRetryStrategy(times: number): number {
  const exponential = Math.min(RETRY_BASE_DELAY_MS * 2 ** (times - 1), RETRY_MAX_DELAY_MS);
  return exponential + Math.floor(Math.random() * RETRY_JITTER_MS);
}

export function buildRedisOptions(config: RedisConfig): RedisOptions {
  return {
    // The connection is initiated by the RedisService lifecycle (without
    // blocking startup) or on first use — never eagerly at construction.
    lazyConnect: true,
    connectTimeout: config.connectTimeoutMs,
    commandTimeout: config.commandTimeoutMs,
    maxRetriesPerRequest: config.maxRetriesPerRequest,
    // Commands issued while the client is not connected fail immediately
    // instead of queueing unboundedly, so callers get a predictable fast
    // failure while Redis is unreachable.
    enableOfflineQueue: false,
    // Commands interrupted by a disconnect are not replayed automatically:
    // replaying non-idempotent commands (e.g. INCR) could double-apply them.
    autoResendUnfulfilledCommands: false,
    retryStrategy: redisRetryStrategy,
    // Empty credentials (e.g. local Redis without AUTH) are omitted so no
    // empty AUTH attempt is sent to the server.
    ...(config.username && { username: config.username }),
    ...(config.password && { password: config.password }),
    ...(config.db !== undefined && { db: config.db }),
    ...(config.tls && { tls: {} }),
  };
}
