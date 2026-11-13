import { HealthIndicatorService } from '@nestjs/terminus';
import { I18nService } from '@nestjs/i18n';
import { describe, expect, it, vi } from 'vitest';

// Unit tests must not depend on ambient environment state, so the env
// validation layer is replaced with a fully valid environment (the indicator
// module chain imports the eagerly-validated env config).
vi.mock('#config/env/env.config.js', () => ({
  _env: {
    APP_ENV: 'test',
    HOST: '0.0.0.0',
    PORT: 3001,
    LOG_LEVEL: 'info',
    REDIS_URL: 'redis://localhost:6379',
    REDIS_USERNAME: '',
    REDIS_PASSWORD: '',
    REDIS_TLS: 'false',
    REDIS_CONNECT_TIMEOUT_MS: 10000,
    REDIS_COMMAND_TIMEOUT_MS: 5000,
    REDIS_MAX_RETRIES_PER_REQUEST: 3,
    REDIS_SHUTDOWN_TIMEOUT_MS: 2000,
    MEMORY_PROTECTION_ENABLED: 'true',
    MEMORY_PROTECTION_MAX_RSS_MB: 1024,
    MEMORY_PROTECTION_RECOVERY_RSS_MB: 768,
    MEMORY_PROTECTION_SAMPLE_INTERVAL_MS: 5000,
    MEMORY_PROTECTION_STABLE_SAMPLES: 3,
  },
}));

import { MemoryHealthIndicator } from './memory.health.indicator.js';
import { MemoryProtectionService } from './memory-protection.service.js';

function createIndicator(isProtected: boolean): MemoryHealthIndicator {
  const memoryProtection = {
    isProtected: vi.fn<() => boolean>(() => isProtected),
  } as unknown as MemoryProtectionService;
  const i18n = {
    t: vi.fn<(key: string) => string>((key) =>
      key === 'health.memoryProtected' ? 'memory pressure' : key,
    ),
  } as unknown as I18nService;

  return new MemoryHealthIndicator(new HealthIndicatorService(), memoryProtection, i18n);
}

describe('MemoryHealthIndicator', () => {
  it('reports up while the protection state is inactive', () => {
    // Arrange
    const indicator = createIndicator(false);

    // Act
    const result = indicator.check();

    // Assert
    expect(result).toEqual({ memory: { status: 'up' } });
  });

  it('reports down with a localized message while the protection state is active', () => {
    // Arrange
    const indicator = createIndicator(true);

    // Act
    const result = indicator.check();

    // Assert
    expect(result).toEqual({ memory: { status: 'down', message: 'memory pressure' } });
  });
});
