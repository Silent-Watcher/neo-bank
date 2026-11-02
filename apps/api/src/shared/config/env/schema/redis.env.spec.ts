import { describe, expect, it } from 'vitest';

import { redisEnvSchema } from './redis.env.js';

describe('redisEnvSchema', () => {
  it('rejects a missing REDIS_URL, REDIS_USERNAME, or REDIS_PASSWORD', () => {
    // Arrange & Act
    const missingAll = redisEnvSchema.safeParse({});
    const missingPassword = redisEnvSchema.safeParse({
      REDIS_URL: 'redis://localhost:6379',
      REDIS_USERNAME: 'default',
    });

    // Assert
    expect(missingAll.success).toBe(false);
    expect(missingPassword.success).toBe(false);
  });

  it('accepts a complete configuration and applies the documented defaults', () => {
    // Arrange & Act
    const result = redisEnvSchema.safeParse({
      REDIS_URL: 'redis://localhost:6379',
      REDIS_USERNAME: 'default',
      REDIS_PASSWORD: '',
    });

    // Assert
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      REDIS_URL: 'redis://localhost:6379',
      REDIS_USERNAME: 'default',
      REDIS_PASSWORD: '',
      REDIS_DB: undefined,
      REDIS_TLS: false,
      REDIS_CONNECT_TIMEOUT_MS: 10000,
      REDIS_COMMAND_TIMEOUT_MS: 5000,
      REDIS_MAX_RETRIES_PER_REQUEST: 3,
      REDIS_SHUTDOWN_TIMEOUT_MS: 2000,
    });
  });

  it('trims REDIS_URL and credentials before validating', () => {
    // Arrange & Act
    const result = redisEnvSchema.parse({
      REDIS_URL: '  redis://localhost:6379  ',
      REDIS_USERNAME: ' default ',
      REDIS_PASSWORD: ' secret ',
    });

    // Assert
    expect(result.REDIS_URL).toBe('redis://localhost:6379');
    expect(result.REDIS_USERNAME).toBe('default');
    expect(result.REDIS_PASSWORD).toBe('secret');
  });

  it('rejects a malformed REDIS_URL', () => {
    // Arrange & Act
    const result = redisEnvSchema.safeParse({
      REDIS_URL: 'not-a-url',
      REDIS_USERNAME: 'default',
      REDIS_PASSWORD: '',
    });

    // Assert
    expect(result.success).toBe(false);
  });

  it('coerces REDIS_DB and rejects out-of-range values', () => {
    // Arrange
    const base = {
      REDIS_URL: 'redis://localhost:6379',
      REDIS_USERNAME: 'default',
      REDIS_PASSWORD: '',
    };

    // Act
    const valid = redisEnvSchema.parse({ ...base, REDIS_DB: '5' });
    const negative = redisEnvSchema.safeParse({ ...base, REDIS_DB: '-1' });
    const tooHigh = redisEnvSchema.safeParse({ ...base, REDIS_DB: '16' });

    // Assert
    expect(valid.REDIS_DB).toBe(5);
    expect(negative.success).toBe(false);
    expect(tooHigh.success).toBe(false);
  });

  it('accepts only the exact strings "true" and "false" for REDIS_TLS', () => {
    // Arrange
    const base = {
      REDIS_URL: 'redis://localhost:6379',
      REDIS_USERNAME: 'default',
      REDIS_PASSWORD: '',
    };

    // Act
    const truthy = redisEnvSchema.parse({ ...base, REDIS_TLS: 'true' });
    const falsy = redisEnvSchema.parse({ ...base, REDIS_TLS: 'false' });
    const invalid = redisEnvSchema.safeParse({ ...base, REDIS_TLS: '1' });

    // Assert
    expect(truthy.REDIS_TLS).toBe(true);
    expect(falsy.REDIS_TLS).toBe(false);
    expect(invalid.success).toBe(false);
  });

  it('rejects non-positive or non-numeric timeout values', () => {
    // Arrange
    const base = {
      REDIS_URL: 'redis://localhost:6379',
      REDIS_USERNAME: 'default',
      REDIS_PASSWORD: '',
    };

    // Act
    const zero = redisEnvSchema.safeParse({ ...base, REDIS_COMMAND_TIMEOUT_MS: '0' });
    const notANumber = redisEnvSchema.safeParse({ ...base, REDIS_CONNECT_TIMEOUT_MS: 'soon' });
    const zeroRetries = redisEnvSchema.safeParse({
      ...base,
      REDIS_MAX_RETRIES_PER_REQUEST: '0',
    });

    // Assert
    expect(zero.success).toBe(false);
    expect(notANumber.success).toBe(false);
    expect(zeroRetries.success).toBe(false);
  });
});
