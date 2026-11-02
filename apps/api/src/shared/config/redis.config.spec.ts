import { afterEach, describe, expect, it, vi } from 'vitest';

describe('redisConfig factory', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadFactory() {
    const { default: redisConfig } = await import('./redis.config.js');

    return redisConfig;
  }

  function stubRedisEnv(overrides: Record<string, string> = {}) {
    vi.stubEnv('HOST', '0.0.0.0');
    vi.stubEnv('PORT', '3000');
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    vi.stubEnv('REDIS_USERNAME', 'default');
    vi.stubEnv('REDIS_PASSWORD', 'secret');
    for (const [key, value] of Object.entries(overrides)) {
      vi.stubEnv(key, value);
    }
    vi.resetModules();
  }

  it('maps validated environment values into the typed config namespace', async () => {
    // Arrange
    stubRedisEnv({ REDIS_DB: '2', REDIS_TLS: 'true', REDIS_COMMAND_TIMEOUT_MS: '2500' });

    // Act
    const redisConfig = await loadFactory();

    // Assert
    expect(redisConfig()).toMatchObject({
      url: 'redis://localhost:6379',
      username: 'default',
      password: 'secret',
      db: 2,
      tls: true,
      commandTimeoutMs: 2500,
      connectTimeoutMs: 10000,
      maxRetriesPerRequest: 3,
      shutdownTimeoutMs: 2000,
    });
  });

  it('exposes empty credentials verbatim for no-auth deployments', async () => {
    // Arrange
    stubRedisEnv({ REDIS_USERNAME: '', REDIS_PASSWORD: '' });

    // Act
    const redisConfig = await loadFactory();

    // Assert
    expect(redisConfig().username).toBe('');
    expect(redisConfig().password).toBe('');
  });
});
