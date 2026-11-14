import { afterEach, describe, expect, it, vi } from 'vitest';

describe('databaseConfig factory', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadFactory() {
    const { default: databaseConfig } = await import('./database.config.js');

    return databaseConfig;
  }

  function stubDatabaseEnv(overrides: Record<string, string> = {}) {
    vi.stubEnv('HOST', '0.0.0.0');
    vi.stubEnv('PORT', '3000');
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    vi.stubEnv('REDIS_USERNAME', 'default');
    vi.stubEnv('REDIS_PASSWORD', 'secret');
    vi.stubEnv('ENROLLMENTS_OTP_HMAC_SECRET', 'ab'.repeat(32));
    vi.stubEnv('DATABASE_URL', 'postgres://localhost:5432/neo_bank');
    for (const [key, value] of Object.entries(overrides)) {
      vi.stubEnv(key, value);
    }
    vi.resetModules();
  }

  it('maps the validated environment value into the typed config namespace', async () => {
    // Arrange
    stubDatabaseEnv();

    // Act
    const databaseConfig = await loadFactory();

    // Assert
    expect(databaseConfig()).toEqual({ url: 'postgres://localhost:5432/neo_bank' });
  });

  it('trims the URL before mapping it', async () => {
    // Arrange
    stubDatabaseEnv({ DATABASE_URL: '  postgres://localhost:5432/neo_bank  ' });

    // Act
    const databaseConfig = await loadFactory();

    // Assert
    expect(databaseConfig().url).toBe('postgres://localhost:5432/neo_bank');
  });
});
