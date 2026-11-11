import { afterEach, describe, expect, it, vi } from 'vitest';

describe('logConfig factory', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadFactory() {
    const { default: logConfig } = await import('./log.config.js');

    return logConfig;
  }

  function stubBaseEnv() {
    vi.stubEnv('HOST', '0.0.0.0');
    vi.stubEnv('PORT', '3000');
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    vi.stubEnv('REDIS_USERNAME', '');
    vi.stubEnv('REDIS_PASSWORD', '');
    vi.stubEnv('ENROLLMENTS_OTP_HMAC_SECRET', 'ab'.repeat(32));
  }

  it('enables pretty printing only in the development environment', async () => {
    // Arrange
    vi.stubEnv('APP_ENV', 'development');
    vi.stubEnv('LOG_LEVEL', 'debug');
    stubBaseEnv();
    vi.resetModules();

    // Act
    const logConfig = await loadFactory();

    // Assert
    expect(logConfig()).toEqual({ level: 'debug', pretty: true });
  });

  it('keeps structured JSON logging outside development', async () => {
    // Arrange
    vi.stubEnv('APP_ENV', 'test');
    vi.stubEnv('LOG_LEVEL', 'info');
    stubBaseEnv();
    vi.resetModules();

    // Act
    const logConfig = await loadFactory();

    // Assert
    expect(logConfig()).toEqual({ level: 'info', pretty: false });
  });

  it('lets LOG_PRETTY=false force structured JSON in development', async () => {
    // Arrange
    vi.stubEnv('APP_ENV', 'development');
    vi.stubEnv('LOG_LEVEL', 'debug');
    vi.stubEnv('LOG_PRETTY', 'false');
    stubBaseEnv();
    vi.resetModules();

    // Act
    const logConfig = await loadFactory();

    // Assert
    expect(logConfig()).toEqual({ level: 'debug', pretty: false });
  });

  it('lets LOG_PRETTY=true force pretty printing outside development', async () => {
    // Arrange
    vi.stubEnv('APP_ENV', 'production');
    vi.stubEnv('LOG_LEVEL', 'info');
    vi.stubEnv('LOG_PRETTY', 'true');
    // CORS_ORIGIN is mandatory in production.
    vi.stubEnv('CORS_ORIGIN', 'https://app.example.com');
    stubBaseEnv();
    vi.resetModules();

    // Act
    const logConfig = await loadFactory();

    // Assert
    expect(logConfig()).toEqual({ level: 'info', pretty: true });
  });
});
