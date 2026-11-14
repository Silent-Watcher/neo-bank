import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { TestRedis } from './testcontainers.js';
import type { RedisClient } from '#redis/inject-redis.decorator.js';
import { createRedisClient } from '#redis/redis.provider.js';
import { REDIS_CLIENT } from '#redis/redis.constants.js';
import { RedisService } from '#redis/redis.service.js';
import { challengeRateLimitKey } from '#src/modules/enrollments/enrollments.keys.js';

// Real-Redis integration tests for the OTP send rate limit (pnpm test:redis).
// Uses Testcontainers for isolated, reproducible Redis instances.
// Mocks cannot prove atomicity, expiration, or race-condition behavior.

const MAX_SENDS = 5;
const WINDOW_MINUTES = 60;
const WINDOW_MS = WINDOW_MINUTES * 60 * 1000;
const KEY_TTL_SECONDS = WINDOW_MINUTES * 60;

let testRedis: TestRedis;
let client: RedisClient;
let redisService: RedisService;

async function cleanupKeys(): Promise<void> {
  const keys = await scanRateLimitKeys();
  if (keys.length > 0) {
    await client.unlink(...keys);
  }
}

async function scanRateLimitKeys(): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await client.scan(
      cursor,
      'MATCH',
      'neo-bank:enrollments:challenge:rate-limit:*',
      'COUNT',
      100,
    );
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0');
  return keys;
}

beforeAll(async () => {
  testRedis = new TestRedis();
  const config = await testRedis.start();
  client = createRedisClient(config);
  await client.connect();
  const module = await import('@nestjs/testing').then((m) => m.Test);
  const testingModule = await module
    .createTestingModule({
      providers: [
        RedisService,
        { provide: REDIS_CLIENT, useValue: client },
        {
          provide: require('@nestjs/config').ConfigService,
          useValue: { getOrThrow: vi.fn(() => ({ shutdownTimeoutMs: 2000 })) },
        },
      ],
    })
    .compile();
  redisService = testingModule.get(RedisService);
  await cleanupKeys();
});

afterEach(cleanupKeys);

afterAll(async () => {
  if (client) {
    await client.quit();
  }
  await testRedis.stop();
});

describe('RedisService.checkOtpRateLimit (real Redis via Testcontainers)', () => {
  const phoneNumber = '09123456789';

  it('allows the first OTP send and stores a timestamp entry', async () => {
    // Act
    const allowed = await redisService.checkOtpRateLimit(
      challengeRateLimitKey(phoneNumber),
      MAX_SENDS,
      WINDOW_MINUTES,
    );

    // Assert
    expect(allowed).toBe(true);

    // Verify the sorted set has one entry
    const key = challengeRateLimitKey(phoneNumber);
    const count = await client.zcard(key);
    expect(count).toBe(1);

    // Verify the key has a TTL set (approximately the window TTL)
    const ttl = await client.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(KEY_TTL_SECONDS);
  });

  it('allows up to 5 OTP sends within the window', async () => {
    // Arrange: allow 5 sends
    for (let i = 0; i < MAX_SENDS; i++) {
      const allowed = await redisService.checkOtpRateLimit(
        challengeRateLimitKey(phoneNumber),
        MAX_SENDS,
        WINDOW_MINUTES,
      );
      expect(allowed).toBe(true);
    }

    // Assert: 5 entries in the sorted set
    const key = challengeRateLimitKey(phoneNumber);
    const count = await client.zcard(key);
    expect(count).toBe(MAX_SENDS);
  });

  it('rejects the 6th OTP send within the rolling 60-minute window', async () => {
    // Arrange: make 5 allowed sends
    for (let i = 0; i < MAX_SENDS; i++) {
      const allowed = await redisService.checkOtpRateLimit(
        challengeRateLimitKey(phoneNumber),
        MAX_SENDS,
        WINDOW_MINUTES,
      );
      expect(allowed).toBe(true);
    }

    // Act: 6th send should be rejected
    const allowed = await redisService.checkOtpRateLimit(
      challengeRateLimitKey(phoneNumber),
      MAX_SENDS,
      WINDOW_MINUTES,
    );

    // Assert
    expect(allowed).toBe(false);

    // The sorted set should still have 5 entries (no new entry added)
    const key = challengeRateLimitKey(phoneNumber);
    const count = await client.zcard(key);
    expect(count).toBe(MAX_SENDS);
  });

  it('allows a send after an expired entry is removed from the window', async () => {
    // This test requires time manipulation which is not easily done with real Redis.
    // We'll test the cleanup logic by adding an old entry manually.
    const key = challengeRateLimitKey(phoneNumber);
    const oldTimestamp = Date.now() - WINDOW_MS - 1000; // older than window

    // Add an old entry manually
    await client.zadd(key, oldTimestamp, `old:${oldTimestamp}`);

    // Act: make a new send - the old entry should be cleaned up
    const allowed = await redisService.checkOtpRateLimit(key, MAX_SENDS, WINDOW_MINUTES);

    // Assert: allowed because the old entry was removed
    expect(allowed).toBe(true);

    // Only the new entry should remain
    const count = await client.zcard(key);
    expect(count).toBe(1);
  });

  it('different phone numbers have independent limits', async () => {
    const phoneA = '09123456789';
    const phoneB = '09123456788';

    // Exhaust phone A's quota
    for (let i = 0; i < MAX_SENDS; i++) {
      const allowed = await redisService.checkOtpRateLimit(
        challengeRateLimitKey(phoneA),
        MAX_SENDS,
        WINDOW_MINUTES,
      );
      expect(allowed).toBe(true);
    }
    expect(
      await redisService.checkOtpRateLimit(
        challengeRateLimitKey(phoneA),
        MAX_SENDS,
        WINDOW_MINUTES,
      ),
    ).toBe(false);

    // Phone B should still have full quota
    for (let i = 0; i < MAX_SENDS; i++) {
      const allowed = await redisService.checkOtpRateLimit(
        challengeRateLimitKey(phoneB),
        MAX_SENDS,
        WINDOW_MINUTES,
      );
      expect(allowed).toBe(true);
    }
  });

  it('concurrent requests for the same phone cannot exceed the limit', async () => {
    // Act: fire 10 concurrent requests
    const promises = Array.from({ length: 10 }, () =>
      redisService.checkOtpRateLimit(challengeRateLimitKey(phoneNumber), MAX_SENDS, WINDOW_MINUTES),
    );
    const results = await Promise.all(promises);

    // Assert: exactly 5 allowed, 5 rejected
    const allowedCount = results.filter((r) => r).length;
    const rejectedCount = results.filter((r) => !r).length;
    expect(allowedCount).toBe(MAX_SENDS);
    expect(rejectedCount).toBe(10 - MAX_SENDS);

    // Verify the sorted set has exactly 5 entries
    const key = challengeRateLimitKey(phoneNumber);
    const count = await client.zcard(key);
    expect(count).toBe(MAX_SENDS);
  });

  it('failed/rejected requests do not consume quota (the script only adds on success)', async () => {
    // First, exhaust the quota with 5 successful calls
    for (let i = 0; i < MAX_SENDS; i++) {
      expect(
        await redisService.checkOtpRateLimit(
          challengeRateLimitKey(phoneNumber),
          MAX_SENDS,
          WINDOW_MINUTES,
        ),
      ).toBe(true);
    }

    // Now make 3 more calls - all should fail
    for (let i = 0; i < 3; i++) {
      expect(
        await redisService.checkOtpRateLimit(
          challengeRateLimitKey(phoneNumber),
          MAX_SENDS,
          WINDOW_MINUTES,
        ),
      ).toBe(false);
    }

    // The sorted set should still have only 5 entries (no new entries on rejection)
    const key = challengeRateLimitKey(phoneNumber);
    const count = await client.zcard(key);
    expect(count).toBe(MAX_SENDS);
  });

  it('expired entries are removed before counting (rolling window)', async () => {
    // This test verifies the rolling window behavior by manually adding
    // entries with old timestamps and verifying they are cleaned up.
    const key = challengeRateLimitKey(phoneNumber);

    // Add 3 old entries (outside the 60-minute window)
    const oldTimestamp = Date.now() - WINDOW_MS - 1000;
    await client.zadd(key, oldTimestamp, `old1:${oldTimestamp}`);
    await client.zadd(key, oldTimestamp - 1000, `old2:${oldTimestamp - 1000}`);
    await client.zadd(key, oldTimestamp - 2000, `old3:${oldTimestamp - 2000}`);

    // Add 2 recent entries (within the window)
    const recentTimestamp = Date.now() - 1000;
    await client.zadd(key, recentTimestamp, `recent1:${recentTimestamp}`);
    await client.zadd(key, recentTimestamp - 1000, `recent2:${recentTimestamp - 1000}`);

    // Now we have 5 entries total, but 3 are expired
    // The next call should clean up the old ones and allow the new send
    const allowed = await redisService.checkOtpRateLimit(key, MAX_SENDS, WINDOW_MINUTES);

    // Assert: allowed because only 2 recent entries remain after cleanup
    expect(allowed).toBe(true);

    // Should have 3 entries now (2 recent + 1 new)
    const count = await client.zcard(key);
    expect(count).toBe(3);
  });

  it('handles Redis errors gracefully (propagates to caller)', async () => {
    // Create a service with a client pointing to an unroutable address
    const closedClient = createRedisClient({
      url: 'redis://127.0.0.1:1', // Unroutable
      username: '',
      password: '',
      db: 0,
      tls: false,
      connectTimeoutMs: 100,
      commandTimeoutMs: 100,
      maxRetriesPerRequest: 1,
      shutdownTimeoutMs: 100,
    });
    // Don't await connect - we want it to fail when we call the method
    closedClient.connect().catch(() => {});

    const module = await import('@nestjs/testing').then((m) => m.Test);
    const testingModule = await module
      .createTestingModule({
        providers: [
          RedisService,
          { provide: REDIS_CLIENT, useValue: closedClient },
          {
            provide: require('@nestjs/config').ConfigService,
            useValue: { getOrThrow: vi.fn(() => ({ shutdownTimeoutMs: 2000 })) },
          },
        ],
      })
      .compile();
    const errorService = testingModule.get(RedisService);

    // Act & Assert: should throw an error when the Lua script is evaluated
    await expect(
      errorService.checkOtpRateLimit(challengeRateLimitKey(phoneNumber), MAX_SENDS, WINDOW_MINUTES),
    ).rejects.toThrow();

    // Disconnect without await to avoid errors on already-failed connection
    closedClient.disconnect();
  });
});
