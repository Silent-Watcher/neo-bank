import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { TestRedis } from './testcontainers.js';
import type { RedisClient } from '#src/shared/redis/inject-redis.decorator.js';
import { createRedisClient } from '#src/shared/redis/redis.provider.js';
import { throttleBlockKey, throttleHitKey } from '#src/shared/throttler/throttler.keys.js';
import { RedisThrottlerStorage } from '#src/shared/throttler/redis-throttler.storage.js';

// Real-Redis integration tests for the rate-limit storage (pnpm test:redis).
// Uses Testcontainers for isolated, reproducible Redis instances.
// Mocks cannot prove atomicity, expiration, or block behavior.

const SHORT_TTL_MS = 400;
const BLOCK_MS = 800;

let testRedis: TestRedis;
let client: RedisClient;
let storage: RedisThrottlerStorage;

async function nextKey(): Promise<string> {
  return `StorageController-testHandler-${crypto.randomUUID()}`;
}

async function cleanupKeys(): Promise<void> {
  const keys = await scanThrottleKeys();
  if (keys.length > 0) {
    await client.unlink(...keys);
  }
}

async function scanThrottleKeys(): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await client.scan(
      cursor,
      'MATCH',
      'neo-bank:throttler:rate-limit:*',
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
  storage = new RedisThrottlerStorage(client);
  await cleanupKeys();
});

afterEach(cleanupKeys);

afterAll(async () => {
  await client.quit();
  await testRedis.stop();
});

describe('RedisThrottlerStorage (real Redis via Testcontainers)', () => {
  describe('counter window', () => {
    it('counts the first request and initializes the counter expiration', async () => {
      // Arrange
      const key = await nextKey();

      // Act
      const record = await storage.increment(key, 60_000, 3, 60_000, 'short');

      // Assert
      expect(record.totalHits).toBe(1);
      expect(record.isBlocked).toBe(false);
      expect(record.timeToExpire).toBe(60);
      expect(record.timeToBlockExpire).toBe(0);
    });

    it('allows requests below the limit and at exactly the limit', async () => {
      // Arrange
      const key = await nextKey();

      // Act
      const first = await storage.increment(key, 60_000, 2, 60_000, 'short');
      const second = await storage.increment(key, 60_000, 2, 60_000, 'short');

      // Assert
      expect(first.totalHits).toBe(1);
      expect(first.isBlocked).toBe(false);
      expect(second.totalHits).toBe(2);
      expect(second.isBlocked).toBe(false);
    });

    it('expires the counter and starts a fresh window', async () => {
      // Arrange
      const key = await nextKey();

      // Act
      await storage.increment(key, SHORT_TTL_MS, 5, SHORT_TTL_MS, 'short');
      await new Promise((resolve) => setTimeout(resolve, SHORT_TTL_MS + 100));
      const afterExpiry = await storage.increment(key, SHORT_TTL_MS, 5, SHORT_TTL_MS, 'short');

      // Assert
      expect(afterExpiry.totalHits).toBe(1);
      expect(afterExpiry.isBlocked).toBe(false);
    });

    it('reinitializes the expiration for a counter that lost its TTL', async () => {
      // Arrange: a counter without TTL must not become a permanent key.
      const key = await nextKey();
      await client.set(throttleHitKey(key), '5');

      // Act
      const record = await storage.increment(key, SHORT_TTL_MS, 10, SHORT_TTL_MS, 'short');
      // TTL truncates to whole seconds, so the precise check uses PTTL.
      const ttl = await client.pttl(throttleHitKey(key));

      // Assert
      expect(record.totalHits).toBe(6);
      expect(record.timeToExpire).toBeGreaterThan(0);
      expect(ttl).toBeGreaterThan(0);
    });
  });

  describe('blocking', () => {
    it('blocks the first request exceeding the limit and reports Retry-After time', async () => {
      // Arrange
      const key = await nextKey();

      // Act
      const first = await storage.increment(key, 60_000, 2, 60_000, 'short');
      const second = await storage.increment(key, 60_000, 2, 60_000, 'short');
      const blocked = await storage.increment(key, 60_000, 2, 60_000, 'short');

      // Assert
      expect(first.isBlocked).toBe(false);
      expect(second.isBlocked).toBe(false);
      expect(blocked.totalHits).toBe(3);
      expect(blocked.isBlocked).toBe(true);
      expect(blocked.timeToBlockExpire).toBe(60);
      expect(blocked.timeToExpire).toBeGreaterThan(0);
    });

    it('does not increment the counter or extend the block while blocked', async () => {
      // Arrange: limit 2, counter at 3, block active.
      const key = await nextKey();
      await storage.increment(key, 60_000, 2, 60_000, 'short');
      await storage.increment(key, 60_000, 2, 60_000, 'short');
      await storage.increment(key, 60_000, 2, 60_000, 'short');

      // Act
      const duringBlock = await storage.increment(key, 60_000, 2, 60_000, 'short');

      // Assert: the counter stayed at 3 (no INCR) and the block remains.
      expect(duringBlock.isBlocked).toBe(true);
      expect(duringBlock.totalHits).toBe(3);
      expect(await client.exists(throttleBlockKey(key))).toBe(1);
    });
  });

  describe('block-duration regression (nest-lab issue #74)', () => {
    it('does not rearm a stale counter after the advertised Retry-After', async () => {
      // Arrange: block duration longer than the counter TTL — the exact
      // pattern that breaks the community provider.
      const key = await nextKey();

      // Act: exhaust the limit, trigger the block, and let the counter window
      // expire while the block is still active.
      await storage.increment(key, SHORT_TTL_MS, 2, BLOCK_MS, 'short');
      await storage.increment(key, SHORT_TTL_MS, 2, BLOCK_MS, 'short');
      const blocked = await storage.increment(key, SHORT_TTL_MS, 2, BLOCK_MS, 'short');
      expect(blocked.isBlocked).toBe(true);

      // A request arriving while the counter has expired but the block is
      // active must not recreate the counter.
      await new Promise((resolve) => setTimeout(resolve, SHORT_TTL_MS + 100));
      const duringBlock = await storage.increment(key, SHORT_TTL_MS, 2, BLOCK_MS, 'short');
      expect(duringBlock.isBlocked).toBe(true);
      expect(duringBlock.totalHits).toBe(3);

      // Assert: after the advertised Retry-After elapsed, the next request
      // starts a fresh window instead of being blocked again by the stale
      // counter, and no block key survived.
      await new Promise((resolve) => setTimeout(resolve, BLOCK_MS));
      const afterBlock = await storage.increment(key, SHORT_TTL_MS, 2, BLOCK_MS, 'short');
      expect(afterBlock.isBlocked).toBe(false);
      expect(afterBlock.totalHits).toBe(1);
      expect(await client.exists(throttleBlockKey(key))).toBe(0);
    });

    it('resets the window when the block duration is shorter than the TTL', async () => {
      // Arrange
      const key = await nextKey();

      // Act: block for 300ms inside a 1s window.
      await storage.increment(key, 1000, 1, 300, 'short');
      const blocked = await storage.increment(key, 1000, 1, 300, 'short');
      expect(blocked.isBlocked).toBe(true);

      // Assert: after the short block the client gets a fresh window instead
      // of being re-blocked by the surviving counter.
      await new Promise((resolve) => setTimeout(resolve, 400));
      const afterBlock = await storage.increment(key, 1000, 1, 300, 'short');
      expect(afterBlock.isBlocked).toBe(false);
      expect(afterBlock.totalHits).toBe(1);
    });

    it('handles a block duration equal to the TTL', async () => {
      // Arrange
      const key = await nextKey();

      // Act
      await storage.increment(key, 400, 1, 400, 'short');
      const blocked = await storage.increment(key, 400, 1, 400, 'short');
      expect(blocked.isBlocked).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Assert
      const afterBlock = await storage.increment(key, 400, 1, 400, 'short');
      expect(afterBlock.isBlocked).toBe(false);
      expect(afterBlock.totalHits).toBe(1);
    });
  });

  describe('zero and negative block duration', () => {
    it('rejects on the counter alone and never creates a block key', async () => {
      // Arrange
      const key = await nextKey();

      // Act
      await storage.increment(key, SHORT_TTL_MS, 1, 0, 'short');
      const rejected = await storage.increment(key, SHORT_TTL_MS, 1, 0, 'short');

      // Assert: blocked until the counter window expires; no invalid PX 0 was
      // sent (the block key does not exist).
      expect(rejected.isBlocked).toBe(true);
      expect(rejected.timeToBlockExpire).toBeGreaterThan(0);
      expect(await client.exists(throttleBlockKey(key))).toBe(0);

      await new Promise((resolve) => setTimeout(resolve, SHORT_TTL_MS + 100));
      const afterWindow = await storage.increment(key, SHORT_TTL_MS, 1, 0, 'short');
      expect(afterWindow.isBlocked).toBe(false);
      expect(afterWindow.totalHits).toBe(1);
    });

    it('treats a negative block duration like the zero policy', async () => {
      // Arrange
      const key = await nextKey();

      // Act
      await storage.increment(key, SHORT_TTL_MS, 1, -1000, 'short');
      const rejected = await storage.increment(key, SHORT_TTL_MS, 1, -1000, 'short');

      // Assert
      expect(rejected.isBlocked).toBe(true);
      expect(await client.exists(throttleBlockKey(key))).toBe(0);
    });
  });

  describe('atomicity under concurrency', () => {
    it('admits exactly the limit and blocks the rest in a concurrent burst', async () => {
      // Arrange
      const key = await nextKey();
      const limit = 5;
      const total = 30;

      // Act
      const results = await Promise.all(
        Array.from({ length: total }, () => storage.increment(key, 60_000, limit, 60_000, 'short')),
      );

      // Assert: exactly `limit` requests allowed, one request consumed the
      // limit+1-th hit while creating the block, and no request raced past it.
      const allowed = results.filter((record) => !record.isBlocked);
      const blocked = results.filter((record) => record.isBlocked);
      expect(allowed.length).toBe(limit);
      expect(blocked.length).toBe(total - limit);
      const hits = await client.get(throttleHitKey(key));
      expect(Number(hits)).toBe(limit + 1);
      expect(await client.exists(throttleBlockKey(key))).toBe(1);
    });
  });

  describe('key namespace', () => {
    it('stores hit and block keys under the application throttle namespace', async () => {
      // Arrange
      const key = await nextKey();

      // Act
      await storage.increment(key, 60_000, 1, 60_000, 'short');
      await storage.increment(key, 60_000, 1, 60_000, 'short');

      // Assert
      expect(await client.exists(throttleHitKey(key))).toBe(1);
      expect(await client.exists(throttleBlockKey(key))).toBe(1);
      const keys = await scanThrottleKeys();
      expect(keys.sort()).toEqual([throttleBlockKey(key), throttleHitKey(key)].sort());
    });

    it('keeps different endpoint keys isolated', async () => {
      // Arrange
      const first = await nextKey();
      const second = await nextKey();

      // Act
      await storage.increment(first, 60_000, 1, 60_000, 'short');
      await storage.increment(first, 60_000, 1, 60_000, 'short');
      const other = await storage.increment(second, 60_000, 1, 60_000, 'short');

      // Assert: the second endpoint key has its own untouched quota.
      expect(other.totalHits).toBe(1);
      expect(other.isBlocked).toBe(false);
    });

    it('expires rate-limit keys automatically', async () => {
      // Arrange
      const key = await nextKey();
      await storage.increment(key, SHORT_TTL_MS, 1, SHORT_TTL_MS, 'short');
      expect(await client.exists(throttleHitKey(key))).toBe(1);

      // Act
      await new Promise((resolve) => setTimeout(resolve, SHORT_TTL_MS + 100));

      // Assert: no permanent rate-limit keys are left behind.
      expect(await client.exists(throttleHitKey(key))).toBe(0);
    });
  });
});
