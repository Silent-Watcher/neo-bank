import { describe, expect, it } from 'vitest';

import { enrollmentsEnvSchema } from './enrollments.env.js';

const VALID_SECRET = 'ab'.repeat(32);

describe('enrollmentsEnvSchema', () => {
  describe('defaults', () => {
    it('applies the documented defaults for attempt and lockout values when the HMAC secret is provided', () => {
      // Arrange & Act
      const result = enrollmentsEnvSchema.safeParse({ ENROLLMENTS_OTP_HMAC_SECRET: VALID_SECRET });

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          ENROLLMENTS_MAX_VERIFY_ATTEMPTS: 5,
          ENROLLMENTS_LOCKOUT_TTL_SECONDS: 900,
          ENROLLMENTS_OTP_HMAC_SECRET: VALID_SECRET,
        });
      }
    });
  });

  describe('ENROLLMENTS_OTP_HMAC_SECRET', () => {
    it('is required: a missing secret fails validation', () => {
      // Arrange & Act
      const result = enrollmentsEnvSchema.safeParse({});

      // Assert
      expect(result.success).toBe(false);
    });

    it.each([
      ['empty string', ''],
      ['too short (31 decoded bytes)', 'ab'.repeat(31)],
      ['too long (33 decoded bytes)', 'ab'.repeat(33)],
      ['non-hex characters', 'g'.repeat(64)],
      ['whitespace', ` ${VALID_SECRET} `],
    ])('rejects %s', (_description, value) => {
      // Arrange & Act
      const result = enrollmentsEnvSchema.safeParse({ ENROLLMENTS_OTP_HMAC_SECRET: value });

      // Assert
      expect(result.success).toBe(false);
    });

    it('accepts an exactly 64-character hexadecimal secret (32 decoded bytes)', () => {
      // Arrange & Act
      const result = enrollmentsEnvSchema.safeParse({ ENROLLMENTS_OTP_HMAC_SECRET: VALID_SECRET });

      // Assert
      expect(result.success).toBe(true);
    });

    it('accepts uppercase hexadecimal notation', () => {
      // Arrange & Act
      const result = enrollmentsEnvSchema.safeParse({
        ENROLLMENTS_OTP_HMAC_SECRET: VALID_SECRET.toUpperCase(),
      });

      // Assert
      expect(result.success).toBe(true);
    });
  });
});
