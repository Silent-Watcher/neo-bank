import { describe, expect, it } from 'vitest';

import { buildRedisOptions, redisRetryStrategy } from './redis-options.js';

function createConfig(overrides: Record<string, unknown> = {}) {
  return {
    url: 'redis://localhost:6379',
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

describe('redisRetryStrategy', () => {
  it('starts at the base delay with jitter', () => {
    // Arrange & Act
    const delay = redisRetryStrategy(1);

    // Assert
    expect(delay).toBeGreaterThanOrEqual(200);
    expect(delay).toBeLessThan(300);
  });

  it('grows exponentially across attempts', () => {
    // Arrange & Act
    const first = redisRetryStrategy(1);
    const second = redisRetryStrategy(2);
    const third = redisRetryStrategy(3);

    // Assert
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
  });

  it('caps the delay at the maximum regardless of attempt count', () => {
    // Arrange & Act
    const delay = redisRetryStrategy(100);

    // Assert
    expect(delay).toBeLessThanOrEqual(30100);
  });
});

describe('buildRedisOptions', () => {
  it('configures resilient, non-blocking defaults', () => {
    // Arrange & Act
    const options = buildRedisOptions(createConfig());

    // Assert
    expect(options.lazyConnect).toBe(true);
    expect(options.enableOfflineQueue).toBe(false);
    expect(options.autoResendUnfulfilledCommands).toBe(false);
    expect(options.maxRetriesPerRequest).toBe(3);
    expect(options.connectTimeout).toBe(10000);
    expect(options.commandTimeout).toBe(5000);
  });

  it('omits empty credentials and applies the rest only when configured', () => {
    // Arrange & Act
    const bare = buildRedisOptions(createConfig());
    const full = buildRedisOptions(
      createConfig({
        username: 'default',
        password: 'secret',
        db: 2,
        tls: true,
      }),
    );

    // Assert
    expect(bare.username).toBeUndefined();
    expect(bare.password).toBeUndefined();
    expect(bare.db).toBeUndefined();
    expect(bare.tls).toBeUndefined();
    expect(full.username).toBe('default');
    expect(full.password).toBe('secret');
    expect(full.db).toBe(2);
    expect(full.tls).toEqual({});
  });
});
