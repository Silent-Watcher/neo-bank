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
});
