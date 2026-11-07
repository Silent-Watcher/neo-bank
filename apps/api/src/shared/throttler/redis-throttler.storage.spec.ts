import { describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';

import { throttleBlockKey, throttleHitKey } from './throttler.keys.js';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

// Unit tests for the storage contract details that do not need a Redis
// server; atomicity, expiration, and blocking behavior are covered by the
// real-Redis suite (pnpm test:redis).

interface CapturedCall {
  script: string;
  args: unknown[];
}

function stubClient(reply: unknown): { client: Redis; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const client = {
    eval: (script: string, ...args: unknown[]) => {
      calls.push({ script, args });
      return Promise.resolve(reply);
    },
  } as unknown as Redis;
  return { client, calls };
}

describe('RedisThrottlerStorage (unit)', () => {
  it('defines no connection lifecycle of its own', () => {
    // Arrange & Act & Assert: the storage must never close or reconnect the
    // shared connection — lifecycle stays with the owning RedisModule.
    // Use 'in' operator to check for own properties since they don't exist on
    // the class prototype at all (not even as undefined).
    expect('onModuleDestroy' in RedisThrottlerStorage.prototype).toBe(false);
    expect('onApplicationShutdown' in RedisThrottlerStorage.prototype).toBe(false);
    expect('beforeApplicationShutdown' in RedisThrottlerStorage.prototype).toBe(false);
  });

  it('runs one atomic Lua call with namespaced keys and ms arguments', async () => {
    // Arrange
    const { client, calls } = stubClient([1, 60_000, 0, 0]);
    const storage = new RedisThrottlerStorage(client);

    // Act
    await storage.increment('abc', 60_000, 3, 60_000, 'short');

    // Assert: a single eval; keys carry the app namespace and hash tag; the
    // ttl/limit/blockDuration arguments stay in milliseconds.
    expect(calls.length).toBe(1);
    expect(calls[0]!.args).toEqual([
      2,
      throttleHitKey('abc'),
      throttleBlockKey('abc'),
      60_000,
      3,
      60_000,
    ]);
    expect(throttleHitKey('abc')).toBe('neo-bank:throttler:rate-limit:hit:{abc}');
    expect(throttleBlockKey('abc')).toBe('neo-bank:throttler:rate-limit:block:{abc}');
  });

  it('converts millisecond replies to seconds with ceiling', async () => {
    // Arrange: 1500 ms must become 2 s so a client never retries early.
    const { client } = stubClient([2, 1500, 1, 1]);
    const storage = new RedisThrottlerStorage(client);

    // Act
    const record = await storage.increment('abc', 60_000, 1, 60_000, 'short');

    // Assert
    expect(record).toEqual({
      totalHits: 2,
      timeToExpire: 2,
      isBlocked: true,
      timeToBlockExpire: 1,
    });
  });

  it('accepts numeric string replies (stringNumbers clients)', async () => {
    // Arrange
    const { client } = stubClient(['2', '1500', '1', '1']);
    const storage = new RedisThrottlerStorage(client);

    // Act & Assert
    await expect(storage.increment('abc', 60_000, 1, 60_000, 'short')).resolves.toEqual({
      totalHits: 2,
      timeToExpire: 2,
      isBlocked: true,
      timeToBlockExpire: 1,
    });
  });

  it.each([
    ['not an array', 'nope'],
    ['too short', [1, 60_000, 0]],
    ['non-numeric hit count', ['x', 60_000, 0, 0]],
    ['empty string number', [1, 60_000, 0, '']],
    ['float value', [1.5, 60_000, 0, 0]],
  ])('throws on a malformed script reply: %s', async (_description, reply) => {
    // Arrange
    const { client } = stubClient(reply);
    const storage = new RedisThrottlerStorage(client);

    // Act & Assert: malformed results surface as errors, never as a fake
    // allow/deny verdict.
    await expect(storage.increment('abc', 60_000, 1, 60_000, 'short')).rejects.toThrow();
  });
});
