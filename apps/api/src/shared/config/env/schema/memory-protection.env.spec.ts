import { describe, expect, it } from 'vitest';

import { isRecoveryThresholdInvalid, memoryProtectionEnvSchema } from './memory-protection.env.js';

describe('memoryProtectionEnvSchema', () => {
  describe('defaults', () => {
    it('applies every documented default when the variables are missing', () => {
      // Arrange
      const input = {};

      // Act
      const result = memoryProtectionEnvSchema.parse(input);

      // Assert
      expect(result).toEqual({
        MEMORY_PROTECTION_ENABLED: true,
        MEMORY_PROTECTION_MAX_RSS_MB: 1024,
        MEMORY_PROTECTION_RECOVERY_RSS_MB: 768,
        MEMORY_PROTECTION_SAMPLE_INTERVAL_MS: 5000,
        MEMORY_PROTECTION_STABLE_SAMPLES: 3,
      });
    });
  });

  describe('MEMORY_PROTECTION_ENABLED', () => {
    it('accepts only the exact strings "true" and "false"', () => {
      // Arrange & Act & Assert
      expect(
        memoryProtectionEnvSchema.parse({ MEMORY_PROTECTION_ENABLED: 'true' })[
          'MEMORY_PROTECTION_ENABLED'
        ],
      ).toBe(true);
      expect(
        memoryProtectionEnvSchema.parse({ MEMORY_PROTECTION_ENABLED: 'false' })[
          'MEMORY_PROTECTION_ENABLED'
        ],
      ).toBe(false);
      expect(
        memoryProtectionEnvSchema.safeParse({ MEMORY_PROTECTION_ENABLED: 'TRUE' }).success,
      ).toBe(false);
      expect(memoryProtectionEnvSchema.safeParse({ MEMORY_PROTECTION_ENABLED: '1' }).success).toBe(
        false,
      );
    });
  });

  describe('thresholds and timing', () => {
    it('accepts positive integers for the numeric fields', () => {
      // Arrange
      const input = {
        MEMORY_PROTECTION_MAX_RSS_MB: '512',
        MEMORY_PROTECTION_RECOVERY_RSS_MB: '384',
        MEMORY_PROTECTION_SAMPLE_INTERVAL_MS: '1000',
        MEMORY_PROTECTION_STABLE_SAMPLES: '2',
      };

      // Act
      const result = memoryProtectionEnvSchema.parse(input);

      // Assert
      expect(result.MEMORY_PROTECTION_MAX_RSS_MB).toBe(512);
      expect(result.MEMORY_PROTECTION_RECOVERY_RSS_MB).toBe(384);
      expect(result.MEMORY_PROTECTION_SAMPLE_INTERVAL_MS).toBe(1000);
      expect(result.MEMORY_PROTECTION_STABLE_SAMPLES).toBe(2);
    });

    it.each([['0'], ['-1'], ['1.5'], ['abc'], [''], ['  ']])(
      'rejects %j as a threshold or timing value',
      (value) => {
        // Arrange
        const input = { MEMORY_PROTECTION_MAX_RSS_MB: value };

        // Act
        const result = memoryProtectionEnvSchema.safeParse(input);

        // Assert
        expect(result.success).toBe(false);
      },
    );

    it('accepts the sample interval at its upper bound and rejects anything above it', () => {
      // Arrange: Node clamps timer delays above 2^31-1 ms to 1 ms, so the
      // schema bounds the interval to 1 hour instead of accepting values that
      // would silently invert the sampling cadence.
      const atBound = { MEMORY_PROTECTION_SAMPLE_INTERVAL_MS: '3600000' };
      const aboveBound = { MEMORY_PROTECTION_SAMPLE_INTERVAL_MS: '3600001' };

      // Act
      const accepted = memoryProtectionEnvSchema.safeParse(atBound);
      const rejected = memoryProtectionEnvSchema.safeParse(aboveBound);

      // Assert
      expect(accepted.success).toBe(true);
      expect(rejected.success).toBe(false);
    });
  });
});

describe('isRecoveryThresholdInvalid', () => {
  it('is invalid when recovery equals the activation threshold', () => {
    // Arrange & Act & Assert
    expect(
      isRecoveryThresholdInvalid({
        MEMORY_PROTECTION_MAX_RSS_MB: 768,
        MEMORY_PROTECTION_RECOVERY_RSS_MB: 768,
      }),
    ).toBe(true);
  });

  it('is invalid when recovery exceeds the activation threshold', () => {
    // Arrange & Act & Assert
    expect(
      isRecoveryThresholdInvalid({
        MEMORY_PROTECTION_MAX_RSS_MB: 512,
        MEMORY_PROTECTION_RECOVERY_RSS_MB: 768,
      }),
    ).toBe(true);
  });

  it('is valid when recovery is strictly below the activation threshold', () => {
    // Arrange & Act & Assert
    expect(
      isRecoveryThresholdInvalid({
        MEMORY_PROTECTION_MAX_RSS_MB: 1024,
        MEMORY_PROTECTION_RECOVERY_RSS_MB: 768,
      }),
    ).toBe(false);
  });
});
