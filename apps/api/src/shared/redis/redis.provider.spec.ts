import { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';

// Unit tests must not depend on ambient environment state, so the env
// validation layer is replaced with a fully valid environment.
vi.mock('#config/env/env.config.js', () => ({
  _env: {
    REDIS_URL: 'redis://localhost:6379',
    REDIS_USERNAME: undefined,
    REDIS_PASSWORD: undefined,
    REDIS_DB: undefined,
    REDIS_TLS: false,
    REDIS_CONNECT_TIMEOUT_MS: 10000,
    REDIS_COMMAND_TIMEOUT_MS: 5000,
    REDIS_MAX_RETRIES_PER_REQUEST: 3,
    REDIS_SHUTDOWN_TIMEOUT_MS: 2000,
  },
}));

import type { RedisConfig } from '#config/redis.config.js';

import { createRedisClient } from './redis.provider.js';

function createConfig(overrides: Partial<RedisConfig> = {}): RedisConfig {
  return {
    url: 'redis://127.0.0.1:1',
    username: '',
    password: '',
    db: undefined,
    tls: false,
    connectTimeoutMs: 10000,
    commandTimeoutMs: 5000,
    maxRetriesPerRequest: 3,
    shutdownTimeoutMs: 2000,
    ...overrides,
  };
}

describe('createRedisClient', () => {
  it('constructs a lazy client that does not dial the server at startup', () => {
    // Arrange & Act — unreachable URL; lazyConnect must keep this synchronous
    // and connection-free so an unavailable Redis cannot block boot.
    const client = createRedisClient(createConfig());

    // Assert
    expect(client).toBeInstanceOf(Redis);
    expect(client.status).toBe('wait');
    expect(client.options?.lazyConnect).toBe(true);
    client.disconnect();
  });

  it('applies the validated timeouts and retry budget to the client', () => {
    // Arrange & Act
    const client = createRedisClient(
      createConfig({
        commandTimeoutMs: 1234,
        connectTimeoutMs: 4321,
        maxRetriesPerRequest: 7,
      }),
    );

    // Assert
    expect(client.options?.commandTimeout).toBe(1234);
    expect(client.options?.connectTimeout).toBe(4321);
    expect(client.options?.maxRetriesPerRequest).toBe(7);
    client.disconnect();
  });
});
