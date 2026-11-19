import { Network } from 'testcontainers';
import type { StartedNetwork } from 'testcontainers';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import { IdempotencyStorage } from '@nestjs/idempotency';
import { idempotencyStoreContract } from '@nestjs/idempotency/testing';

import { createRedisClient } from '#redis/redis.provider.js';
import type { RedisConfig } from '#config/redis.config.js';
import { idempotencyRecordKey } from '#src/shared/idempotency/idempotency.keys.js';
import { RedisIdempotencyStore } from '#src/shared/idempotency/redis-idempotency.store.js';

import { startTestRedis, TestToxiproxy } from './testcontainers.js';
import type { TestRedis } from './testcontainers.js';

// Real-Redis integration tier for the idempotency store (ADR-039). Mocks
// cannot prove Lua atomicity, so the official package contract suite
// (`idempotencyStoreContract`, concurrency enabled) runs against a real
// server through Testcontainers, plus the store-specific cases the suite
// does not cover: the bodyless-202 round trip, record TTLs, expired-record
// takeover, unreadable records, and the black-hole failure behavior.
//
// All traffic runs through Toxiproxy even when healthy (no toxics = plain
// forwarding), so the black-hole scenario activates faults on an already
// established connection without re-wiring.

const CLIENT_COMMAND_TIMEOUT_MS = 1500;
const CLIENT_SOCKET_TIMEOUT_MS = 2500;
const CLIENT_CONNECT_TIMEOUT_MS = 3000;
const LOCK_TTL_MS = 60_000;
const RECORD_TTL_MS = 86_400_000;

let network: StartedNetwork;
let testRedis: TestRedis;
let toxiproxy: TestToxiproxy;
let redisConfig: RedisConfig;
let proxyUrl: string;
let client: Redis;
let store: RedisIdempotencyStore;

// Deterministic status wait (the black-hole spec's pattern): polls instead of
// racing client events, so no listener interferes with the assertions.
async function waitForStatus(
  target: Redis,
  predicate: (status: string) => boolean,
  timeoutMs: number,
): Promise<string> {
  const startedAt = Date.now();
  let status = target.status;
  while (!predicate(status)) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(
        `Client did not reach the expected status within ${timeoutMs} ms (last: "${status}").`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    status = target.status;
  }
  return status;
}

async function scanRecordKeys(): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await client.scan(
      cursor,
      'MATCH',
      'neo-bank:idempotency:store:record:*',
      'COUNT',
      100,
    );
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0');
  return keys;
}

async function cleanupKeys(): Promise<void> {
  const keys = await scanRecordKeys();
  if (keys.length > 0) {
    await client.unlink(...keys);
  }
}

beforeAll(async () => {
  network = await new Network().start();
  ({ redis: testRedis, config: redisConfig } = await startTestRedis({
    network,
    networkAlias: 'redis',
  }));
  toxiproxy = new TestToxiproxy();
  await toxiproxy.start({ network });
  await toxiproxy.createProxy('redis', 'redis', 6379);
  const { host, port } = toxiproxy.getProxyEndpoint();
  const url = new URL(redisConfig.url);
  url.hostname = host;
  url.port = String(port);
  proxyUrl = url.toString();

  client = createRedisClient({
    url: proxyUrl,
    username: redisConfig.username,
    password: redisConfig.password,
    db: 0,
    tls: false,
    connectTimeoutMs: CLIENT_CONNECT_TIMEOUT_MS,
    commandTimeoutMs: CLIENT_COMMAND_TIMEOUT_MS,
    socketTimeoutMs: CLIENT_SOCKET_TIMEOUT_MS,
    maxRetriesPerRequest: 3,
    shutdownTimeoutMs: 1000,
  });
  await client.connect();
  await waitForStatus(client, (status) => status === 'ready', 10_000);
  // One store instance for the whole file; it registers itself with its own
  // private IdempotencyStorage (a production app shares the module's one).
  store = new RedisIdempotencyStore(client, new IdempotencyStorage());
  await cleanupKeys();
}, 120_000);

afterEach(cleanupKeys);

afterAll(async () => {
  if (client) {
    await client.quit();
  }
  if (testRedis) await testRedis.stop();
  if (toxiproxy) await toxiproxy.stop();
  if (network) await network.stop();
}, 60_000);

describe('RedisIdempotencyStore (real Redis via Testcontainers)', () => {
  describe('official store contract (idempotencyStoreContract)', () => {
    // The suite returns runner-agnostic cases: acquire races (exactly one
    // winner among 16 concurrent callers), expired lock/record takeover,
    // ownership fencing for complete/release/extend, expiry, and payload
    // serialization. Expiry cases run in real time (a Redis server clock
    // cannot be faked) with the suite's default lockTtl.
    const contractCases = idempotencyStoreContract(() => store, { concurrent: true });

    for (const contractCase of contractCases) {
      it(`${contractCase.name}`, async () => {
        // Each case asserts internally; this expectation makes the runner's
        // no-assertion lint rule explicit and rejects unexpected rejections.
        await expect(contractCase.run()).resolves.toBeUndefined();
      });
    }
  });

  describe('bodyless response round trip', () => {
    it('stores and replays a completed bodyless 202 with an undefined body', async () => {
      // Arrange — the challenge endpoint's result: 202 with no body.
      const key = `bodyless:${crypto.randomUUID()}`;
      const owner = crypto.randomUUID();
      const fingerprint = 'fingerprint-bodyless';

      // Act
      await expect(store.acquire(key, owner, fingerprint, LOCK_TTL_MS)).resolves.toEqual({
        state: 'acquired',
      });
      await expect(
        store.complete(key, owner, { status: 202, headers: {}, body: undefined }, RECORD_TTL_MS),
      ).resolves.toBe(true);
      const replay = await store.acquire(key, `${crypto.randomUUID()}`, fingerprint, LOCK_TTL_MS);

      // Assert — the stored payload reads back exactly as it was written:
      // status 202, no headers, and a body that is undefined, never null.
      expect(replay).toEqual({
        state: 'completed',
        fingerprint,
        response: { status: 202, headers: {}, body: undefined },
      });
      expect((replay as { response: { body?: unknown } }).response.body).toBeUndefined();
    });
  });

  describe('record state', () => {
    it('completes keep the fingerprint, drop the owner, and set the record TTL', async () => {
      // Arrange
      const key = `state:${crypto.randomUUID()}`;
      const owner = crypto.randomUUID();

      // Act
      await store.acquire(key, owner, 'fingerprint-state', LOCK_TTL_MS);
      await store.complete(
        key,
        owner,
        { status: 202, headers: {}, body: undefined },
        RECORD_TTL_MS,
      );
      const record = await client.hgetall(idempotencyRecordKey(key));
      const pttl = await client.pttl(idempotencyRecordKey(key));

      // Assert
      expect(record.state).toBe('completed');
      expect(record.fp).toBe('fingerprint-state');
      expect(record.owner).toBeUndefined();
      expect(JSON.parse(record.resp)).toEqual({ status: 202, headers: {}, body: undefined });
      // Whole-millisecond record TTL handed to PEXPIRE (small execution skew).
      expect(pttl).toBeGreaterThan(RECORD_TTL_MS - 1000);
      expect(pttl).toBeLessThanOrEqual(RECORD_TTL_MS);
    });

    it('takes over an expired completed record as a fresh in-flight lock', async () => {
      // Arrange — a completed record with a short TTL that is left to expire.
      const key = `takeover:${crypto.randomUUID()}`;
      const owner = crypto.randomUUID();
      await store.acquire(key, owner, 'fingerprint-old', LOCK_TTL_MS);
      await store.complete(key, owner, { status: 202, headers: {}, body: undefined }, 60);
      await new Promise((resolve) => setTimeout(resolve, 120));

      // Act
      const takeover = await store.acquire(
        key,
        crypto.randomUUID(),
        'fingerprint-new',
        LOCK_TTL_MS,
      );
      const record = await client.hgetall(idempotencyRecordKey(key));

      // Assert — the expired record does not replay; the new attempt owns a
      // fresh in-flight lock with its own fingerprint.
      expect(takeover).toEqual({ state: 'acquired' });
      expect(record.state).toBe('in-flight');
      expect(record.fp).toBe('fingerprint-new');
      expect(record.owner).toBeTypeOf('string');
      expect(record.resp).toBeUndefined();
    });

    it('fails closed on a completed record whose stored payload is unreadable', async () => {
      // Arrange — a corrupt record (completed state, no readable response).
      const key = `malformed:${crypto.randomUUID()}`;
      await client.hset(idempotencyRecordKey(key), {
        state: 'completed',
        fp: 'fingerprint-corrupt',
      });
      await client.pexpire(idempotencyRecordKey(key), RECORD_TTL_MS);

      // Act + Assert — the store refuses the record instead of letting the
      // operation re-execute over a side effect it cannot rule out.
      await expect(
        store.acquire(key, crypto.randomUUID(), 'fingerprint-corrupt', LOCK_TTL_MS),
      ).rejects.toThrow('Idempotency record is unreadable');
    });
  });

  describe('established-connection black hole (ADR-037 interplay)', () => {
    it('rejects a store acquisition within the command timeout and recovers without a restart', async () => {
      // Arrange — healthy through the proxy first.
      const healthyKey = `blackhole-healthy:${crypto.randomUUID()}`;
      await expect(
        store.acquire(healthyKey, crypto.randomUUID(), 'fp', LOCK_TTL_MS),
      ).resolves.toEqual({ state: 'acquired' });

      // Act — black-hole the established connection: packets dropped in both
      // directions while TCP stays open.
      await toxiproxy.addBlackHoleToxics('redis');
      const hungKey = `blackhole-hung:${crypto.randomUUID()}`;
      const startedAt = Date.now();
      let rejection: unknown;
      await store
        .acquire(hungKey, crypto.randomUUID(), 'fp', LOCK_TTL_MS)
        .catch((error: unknown) => {
          rejection = error;
        });
      const elapsedMs = Date.now() - startedAt;
      await toxiproxy.removeBlackHoleToxics('redis');
      await waitForStatus(client, (status) => status === 'ready', 15_000);

      // Assert — the command failed bounded (commandTimeout, well under the
      // package's outer storeTimeout), and the store works again afterwards:
      // no in-memory fallback, no wedged lock.
      expect(rejection).toBeInstanceOf(Error);
      expect(elapsedMs).toBeLessThan(CLIENT_COMMAND_TIMEOUT_MS + 500);
      const recoveredKey = `blackhole-recovered:${crypto.randomUUID()}`;
      await expect(
        store.acquire(recoveredKey, crypto.randomUUID(), 'fp', LOCK_TTL_MS),
      ).resolves.toEqual({ state: 'acquired' });
    });
  });
});
