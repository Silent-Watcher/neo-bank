import { describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';

// Unit tests must not depend on ambient environment state, so the env
// validation layer is replaced with a fully valid environment.
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
    ENROLLMENTS_MAX_VERIFY_ATTEMPTS: 5,
    ENROLLMENTS_LOCKOUT_TTL_SECONDS: 900,
    ENROLLMENTS_OTP_HMAC_SECRET: '1111111111111111111111111111111111111111111111111111111111111111',
    IDEMPOTENCY_SCOPE_SECRET: '2222222222222222222222222222222222222222222222222222222222222222',
  },
}));

import { challengeIdempotentOptions } from './enrollments.idempotency.js';

const TEST_SECRET = '2222222222222222222222222222222222222222222222222222222222222222';
const scope = challengeIdempotentOptions.scope as (request: { body?: unknown }) => Promise<string>;
const fingerprint = challengeIdempotentOptions.fingerprint as (payload: unknown) => string;
const storeIf = challengeIdempotentOptions.storeIf as (status: number) => boolean;

describe('enrollments idempotency options (ADR-039)', () => {
  describe('scope', () => {
    it('derives the scope as HMAC-SHA256(secret, normalizedPhone) hex', async () => {
      // Act
      const result = await scope({ body: { phoneNumber: '09123456789' } });

      // Assert — the node:crypto call is the independent reference
      // implementation pinning the WebCrypto output byte-for-byte.
      expect(result).toBe(
        createHmac('sha256', TEST_SECRET).update('09123456789', 'utf8').digest('hex'),
      );
    });

    it('maps every accepted phone spelling to the same scope', async () => {
      // Arrange
      const spellings = [
        '09123456789',
        '+989123456789',
        '00989123456789',
        '989123456789',
        '9123456789',
      ];

      // Act
      const scopes = await Promise.all(
        spellings.map((spelling) => scope({ body: { phoneNumber: spelling } })),
      );

      // Assert
      expect(new Set(scopes).size).toBe(1);
    });

    it('produces distinct scopes for distinct phone numbers', async () => {
      // Act
      const first = await scope({ body: { phoneNumber: '09123456789' } });
      const second = await scope({ body: { phoneNumber: '09123456780' } });

      // Assert
      expect(first).not.toBe(second);
    });

    it('is deterministic for invalid input and separates distinct invalid inputs', async () => {
      // Arrange — a request that will fail validation must not collide with
      // another caller's namespace, and the same input must always map to
      // the same scope (the stored 400 stays replayable).

      // Act
      const garbage = await scope({ body: { phoneNumber: '02112345678' } });
      const garbageAgain = await scope({ body: { phoneNumber: '02112345678' } });
      const otherGarbage = await scope({ body: { phoneNumber: 'not-a-phone' } });
      const missingBody = await scope({});

      // Assert
      expect(garbage).toBe(garbageAgain);
      expect(garbage).not.toBe(otherGarbage);
      expect(otherGarbage).not.toBe(missingBody);
      // Every scope stays an HMAC hex digest — no raw input ever leaks.
      for (const value of [garbage, otherGarbage, missingBody]) {
        expect(value).toMatch(/^[0-9a-f]{64}$/);
      }
    });
  });

  describe('fingerprint', () => {
    it('returns the normalized phone so equivalent spellings share one fingerprint', () => {
      // Act
      const fingerprints = ['09123456789', '+989123456789', '00989123456789'].map((value) =>
        fingerprint({ phoneNumber: value }),
      );

      // Assert
      expect(new Set(fingerprints).size).toBe(1);
      expect(fingerprints[0]).toBe('09123456789');
    });

    it('never throws on a missing or non-object body', () => {
      // Act + Assert
      expect(fingerprint(undefined)).toBe('');
      expect(fingerprint('garbage')).toBe('');
      expect(fingerprint({ phoneNumber: 42 })).toBe('');
    });
  });

  describe('storeIf', () => {
    it('stores success and deterministic client errors, never 429 and never 5xx', () => {
      // Act + Assert
      expect(storeIf(202)).toBe(true);
      expect(storeIf(400)).toBe(true);
      expect(storeIf(409)).toBe(true);
      expect(storeIf(422)).toBe(true);
      expect(storeIf(429)).toBe(false);
      expect(storeIf(500)).toBe(false);
      expect(storeIf(503)).toBe(false);
    });
  });

  describe('option values', () => {
    it('carries the ADR-039 contract values', () => {
      // Assert
      expect(challengeIdempotentOptions.required).toBe(true);
      expect(challengeIdempotentOptions.ttl).toBe('24h');
      expect(challengeIdempotentOptions.lockTtl).toBe('60s');
      expect(challengeIdempotentOptions.retryAfter).toBe('1s');
    });

    it('never embeds the scope secret in any exported option value', () => {
      // Assert — the secret is resolved lazily at request time and must not
      // appear in the decorator options.
      expect(JSON.stringify(challengeIdempotentOptions)).not.toContain(TEST_SECRET);
    });
  });
});
