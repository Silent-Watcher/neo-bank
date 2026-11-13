import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Unit tests must not depend on ambient environment state, so the env
// validation layer is replaced with a fully valid environment (the service
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

import type { MemoryProtectionConfig } from '#config/memory-protection.config.js';
import { MemoryProtectionService } from './memory-protection.service.js';

const MB = 1024 * 1024;

function createConfig(overrides?: Partial<MemoryProtectionConfig>): MemoryProtectionConfig {
  return {
    enabled: true,
    maxRssMb: 1024,
    recoveryRssMb: 768,
    sampleIntervalMs: 5000,
    stableSamples: 3,
    ...overrides,
  };
}

function setRssMb(rssMb: number): void {
  vi.spyOn(process, 'memoryUsage').mockReturnValue({
    rss: rssMb * MB,
    heapTotal: rssMb * MB,
    heapUsed: 0,
    external: 0,
    arrayBuffers: 0,
  });
}

describe('MemoryProtectionService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('disabled configuration', () => {
    it('never samples and never protects when disabled', () => {
      // Arrange
      const service = new MemoryProtectionService(createConfig({ enabled: false }));

      // Act
      service.onApplicationBootstrap();
      setRssMb(4096);
      vi.advanceTimersByTime(60000);

      // Assert
      expect(service.isProtected()).toBe(false);
    });
  });

  describe('activation', () => {
    it('samples immediately at bootstrap and activates when RSS already exceeds the threshold', () => {
      // Arrange
      setRssMb(2000);
      const service = new MemoryProtectionService(createConfig());

      // Act
      service.onApplicationBootstrap();

      // Assert
      expect(service.isProtected()).toBe(true);
    });

    it('activates on the first sample that reaches the activation threshold', () => {
      // Arrange
      setRssMb(512);
      const service = new MemoryProtectionService(createConfig());
      service.onApplicationBootstrap();

      // Act
      setRssMb(1024);
      vi.advanceTimersByTime(5000);

      // Assert
      expect(service.isProtected()).toBe(true);
    });

    it('does not activate while RSS stays below the threshold', () => {
      // Arrange
      setRssMb(1023);
      const service = new MemoryProtectionService(createConfig());

      // Act
      service.onApplicationBootstrap();
      vi.advanceTimersByTime(60000);

      // Assert
      expect(service.isProtected()).toBe(false);
    });
  });

  describe('recovery', () => {
    it('recovers only after the configured number of consecutive stable samples', () => {
      // Arrange
      setRssMb(2000);
      const service = new MemoryProtectionService(
        createConfig({ recoveryRssMb: 768, stableSamples: 3 }),
      );
      service.onApplicationBootstrap();
      expect(service.isProtected()).toBe(true);

      // Act & Assert: first two samples below the recovery threshold are not enough.
      setRssMb(500);
      vi.advanceTimersByTime(5000);
      expect(service.isProtected()).toBe(true);
      vi.advanceTimersByTime(5000);
      expect(service.isProtected()).toBe(true);

      // The third consecutive sample completes recovery.
      vi.advanceTimersByTime(5000);
      expect(service.isProtected()).toBe(false);
    });

    it('restarts the stabilization streak when RSS rises back above the recovery threshold', () => {
      // Arrange
      setRssMb(2000);
      const service = new MemoryProtectionService(
        createConfig({ recoveryRssMb: 768, stableSamples: 2 }),
      );
      service.onApplicationBootstrap();
      expect(service.isProtected()).toBe(true);

      // Act & Assert: one stable sample, then a spike, then one stable sample —
      // the streak restarted, so protection must still be active.
      setRssMb(500);
      vi.advanceTimersByTime(5000);
      setRssMb(900);
      vi.advanceTimersByTime(5000);
      setRssMb(500);
      vi.advanceTimersByTime(5000);
      expect(service.isProtected()).toBe(true);

      vi.advanceTimersByTime(5000);
      expect(service.isProtected()).toBe(false);
    });
  });

  describe('retry hint', () => {
    it('rounds the sample interval up to whole seconds, minimum one', () => {
      // Arrange & Act & Assert
      expect(
        new MemoryProtectionService(
          createConfig({ sampleIntervalMs: 5000 }),
        ).getSecondsUntilNextSample(),
      ).toBe(5);
      expect(
        new MemoryProtectionService(
          createConfig({ sampleIntervalMs: 500 }),
        ).getSecondsUntilNextSample(),
      ).toBe(1);
      expect(
        new MemoryProtectionService(
          createConfig({ sampleIntervalMs: 1500 }),
        ).getSecondsUntilNextSample(),
      ).toBe(2);
    });
  });

  describe('shutdown', () => {
    it('stops sampling after shutdown', () => {
      // Arrange
      setRssMb(512);
      const service = new MemoryProtectionService(createConfig());
      service.onApplicationBootstrap();
      service.onApplicationShutdown();

      // Act: RSS crosses the threshold but no timer is left to sample it.
      setRssMb(4096);
      vi.advanceTimersByTime(60000);

      // Assert
      expect(service.isProtected()).toBe(false);
    });
  });
});
