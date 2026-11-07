import { describe, expect, it } from 'vitest';

import { rateLimitEnvSchema } from './rate-limit.env.js';

describe('rateLimitEnvSchema', () => {
  describe('defaults', () => {
    it('applies the documented default policies when nothing is set', () => {
      // Arrange & Act
      const result = rateLimitEnvSchema.safeParse({});

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          RATE_LIMIT_SHORT_LIMIT: 10,
          RATE_LIMIT_SHORT_TTL_SECONDS: 1,
          RATE_LIMIT_LONG_LIMIT: 100,
          RATE_LIMIT_LONG_TTL_MINUTES: 1,
        });
      }
    });
  });

  describe('valid values', () => {
    it('accepts numeric strings and coerces them to integers', () => {
      // Arrange
      const input = {
        RATE_LIMIT_SHORT_LIMIT: '5',
        RATE_LIMIT_SHORT_TTL_SECONDS: '2',
        RATE_LIMIT_LONG_LIMIT: '50',
        RATE_LIMIT_LONG_TTL_MINUTES: '3',
      };

      // Act
      const result = rateLimitEnvSchema.safeParse(input);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          RATE_LIMIT_SHORT_LIMIT: 5,
          RATE_LIMIT_SHORT_TTL_SECONDS: 2,
          RATE_LIMIT_LONG_LIMIT: 50,
          RATE_LIMIT_LONG_TTL_MINUTES: 3,
        });
      }
    });

    it('accepts the maximum safe integer', () => {
      // Arrange & Act
      const result = rateLimitEnvSchema.safeParse({ RATE_LIMIT_LONG_LIMIT: '9007199254740991' });

      // Assert
      expect(result.success).toBe(true);
    });
  });

  describe('invalid values', () => {
    it.each([
      ['non-numeric string', 'abc'],
      ['empty string', ''],
      ['zero', '0'],
      ['negative', '-1'],
      ['float', '1.5'],
      ['beyond the safe integer range', '9007199254740992'],
    ])('rejects %s', (_description, value) => {
      // Arrange & Act
      const result = rateLimitEnvSchema.safeParse({ RATE_LIMIT_SHORT_LIMIT: value });

      // Assert
      expect(result.success).toBe(false);
    });
  });
});
