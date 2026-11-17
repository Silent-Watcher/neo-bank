import { describe, expect, it } from 'vitest';

import { dbEnvSchema } from './db.env.js';

describe('dbEnvSchema', () => {
  it('rejects a missing DATABASE_URL', () => {
    // Arrange & Act
    const result = dbEnvSchema.safeParse({});

    // Assert
    expect(result.success).toBe(false);
  });

  it('accepts a postgres:// URL and a postgresql:// URL', () => {
    // Arrange & Act
    const short = dbEnvSchema.safeParse({ DATABASE_URL: 'postgres://localhost:5432/neo_bank' });
    const long = dbEnvSchema.safeParse({ DATABASE_URL: 'postgresql://localhost:5432/neo_bank' });

    // Assert
    expect(short.success).toBe(true);
    expect(long.success).toBe(true);
  });

  it('trims DATABASE_URL before validating', () => {
    // Arrange & Act
    const result = dbEnvSchema.parse({ DATABASE_URL: '  postgres://localhost:5432/neo_bank  ' });

    // Assert
    expect(result.DATABASE_URL).toBe('postgres://localhost:5432/neo_bank');
  });

  it('rejects a malformed DATABASE_URL', () => {
    // Arrange & Act
    const notAUrl = dbEnvSchema.safeParse({ DATABASE_URL: 'not-a-url' });
    const wrongProtocol = dbEnvSchema.safeParse({ DATABASE_URL: 'mysql://localhost:3306/db' });

    // Assert
    expect(notAUrl.success).toBe(false);
    expect(wrongProtocol.success).toBe(false);
  });

  it('defaults DATABASE_POOL_MAX to 10 when absent', () => {
    // Arrange & Act
    const result = dbEnvSchema.parse({ DATABASE_URL: 'postgres://localhost:5432/neo_bank' });

    // Assert
    expect(result.DATABASE_POOL_MAX).toBe(10);
  });

  it('coerces DATABASE_POOL_MAX from its environment string', () => {
    // Arrange & Act
    const result = dbEnvSchema.parse({
      DATABASE_URL: 'postgres://localhost:5432/neo_bank',
      DATABASE_POOL_MAX: '20',
    });

    // Assert
    expect(result.DATABASE_POOL_MAX).toBe(20);
  });

  it('rejects a non-positive or non-integer DATABASE_POOL_MAX', () => {
    // Arrange & Act
    const zero = dbEnvSchema.safeParse({
      DATABASE_URL: 'postgres://localhost:5432/neo_bank',
      DATABASE_POOL_MAX: '0',
    });
    const negative = dbEnvSchema.safeParse({
      DATABASE_URL: 'postgres://localhost:5432/neo_bank',
      DATABASE_POOL_MAX: '-1',
    });
    const fractional = dbEnvSchema.safeParse({
      DATABASE_URL: 'postgres://localhost:5432/neo_bank',
      DATABASE_POOL_MAX: '2.5',
    });

    // Assert
    expect(zero.success).toBe(false);
    expect(negative.success).toBe(false);
    expect(fractional.success).toBe(false);
  });

  it('treats a blank DATABASE_POOL_MAX as unset and applies the default', () => {
    // Arrange & Act — the repo-wide convention: an empty entry in an env file
    // behaves exactly like a missing variable.
    const blank = dbEnvSchema.parse({
      DATABASE_URL: 'postgres://localhost:5432/neo_bank',
      DATABASE_POOL_MAX: '',
    });
    const whitespace = dbEnvSchema.parse({
      DATABASE_URL: 'postgres://localhost:5432/neo_bank',
      DATABASE_POOL_MAX: '   ',
    });

    // Assert
    expect(blank.DATABASE_POOL_MAX).toBe(10);
    expect(whitespace.DATABASE_POOL_MAX).toBe(10);
  });
});
