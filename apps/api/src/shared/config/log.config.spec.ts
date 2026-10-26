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

  it('enables pretty printing only in the development environment', async () => {
    // Arrange
    vi.stubEnv('APP_ENV', 'development');
    vi.stubEnv('HOST', '0.0.0.0');
    vi.stubEnv('PORT', '3000');
    vi.stubEnv('LOG_LEVEL', 'debug');
    vi.resetModules();

    // Act
    const logConfig = await loadFactory();

    // Assert
    expect(logConfig()).toEqual({ level: 'debug', pretty: true });
  });

  it('keeps structured JSON logging outside development', async () => {
    // Arrange
    vi.stubEnv('APP_ENV', 'test');
    vi.stubEnv('HOST', '0.0.0.0');
    vi.stubEnv('PORT', '3000');
    vi.resetModules();

    // Act
    const logConfig = await loadFactory();

    // Assert
    expect(logConfig()).toEqual({ level: 'info', pretty: false });
  });
});
