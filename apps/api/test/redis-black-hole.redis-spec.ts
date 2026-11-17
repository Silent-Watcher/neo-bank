import { Network } from 'testcontainers';
import type { StartedNetwork } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';

import { createRedisClient } from '#redis/redis.provider.js';
import type { RedisConfig } from '#config/redis.config.js';

import { startTestRedis, TestToxiproxy } from './testcontainers.js';
import type { TestRedis } from './testcontainers.js';

// Redis black-hole integration tier (ADR-037): reproduces the established-
// connection network black hole — packets silently dropped in BOTH directions
// while the TCP connection itself stays open — against a real Redis server
// through Toxiproxy, and proves the configured recovery chain end to end:
// the command rejects within `commandTimeout` while the client still reports
// `ready` (verified ioredis behavior), `socketTimeout` then destroys the
// silent socket, the bounded reconnect cycle takes over with immediate
// fast-fail (offline queue disabled), an ambiguous command is never executed
// twice, and everything recovers once the fault clears — without restart.
//
// Short deadlines keep the suite fast; the production defaults sit higher
// (command 5000 / socket 6000) with the same ordering guarantees. Tests share
// one client and run in declaration order: the fault starts in the second
// test and clears in the fourth.

const CLIENT_COMMAND_TIMEOUT_MS = 1500;
const CLIENT_SOCKET_TIMEOUT_MS = 2500;
const CLIENT_CONNECT_TIMEOUT_MS = 3000;
const COUNTER_KEY = 'neo-bank:test:black-hole-counter';

// Deterministic status wait: polls instead of racing events, so no client
// event needs a listener that could interfere with the assertions.
async function waitForStatus(
  client: Redis,
  predicate: (status: string) => boolean,
  timeoutMs: number,
): Promise<string> {
  const startedAt = Date.now();
  let status = client.status;
  while (!predicate(status)) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(
        `Client did not reach the expected status within ${timeoutMs} ms (last: "${status}").`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    status = client.status;
  }
  return status;
}

let network: StartedNetwork;
let redisContainer: TestRedis;
let toxiproxy: TestToxiproxy;
let redisConfig: RedisConfig;
let proxyUrl: string;
// The command written into the black hole while the client still reports
// "ready": its outcome is genuinely ambiguous (it can never reach the server
// through the toxics, but a real black hole could deliver it late), and its
// rejection is consumed where it is asserted — never unhandled.
let ambiguousIncrement: Promise<number> | null = null;

beforeAll(async () => {
  network = await new Network().start();
  ({ redis: redisContainer, config: redisConfig } = await startTestRedis({
    network,
    networkAlias: 'redis',
  }));
  toxiproxy = new TestToxiproxy();
  await toxiproxy.start({ network });
  // The proxy listens inside the container network and forwards to the
  // Redis alias; test-process clients reach it through the mapped port.
  await toxiproxy.createProxy('redis', 'redis', 6379);
  const { host, port } = toxiproxy.getProxyEndpoint();
  const url = new URL(redisConfig.url);
  url.hostname = host;
  url.port = String(port);
  proxyUrl = url.toString();
}, 120_000);

afterAll(async () => {
  // Guarded: a failed beforeAll must not mask its own error with a
  // teardown TypeError, and the remaining resources must still reach
  // their own teardown.
  if (redisContainer) await redisContainer.stop();
  if (toxiproxy) await toxiproxy.stop();
  if (network) await network.stop();
}, 60_000);

describe('Redis established-connection black hole (ADR-037)', () => {
  let client: Redis;

  beforeAll(async () => {
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
    // The socket-destruction error events under test are expected; in
    // production RedisService's own `error` listener receives them. The raw
    // test client needs a no-op listener so they do not print as unhandled.
    client.on('error', () => undefined);
  });

  afterAll(async () => {
    // Safe from every client status; also cancels a pending reconnect timer.
    if (client) client.disconnect();
  });

  it('serves commands through the proxy before the fault', async () => {
    // Arrange & Act & Assert — establishes a healthy connection that
    // traverses the proxy, and the server-side baseline for the
    // ambiguity assertion below.
    await expect(client.ping()).resolves.toBe('PONG');
    await expect(client.set(COUNTER_KEY, '0')).resolves.toBe('OK');
  });

  it('rejects a black-holed command within the command timeout while the socket stays ready', async () => {
    // Arrange — the exact attack scenario: the established connection keeps
    // running while every packet is silently dropped in both directions.
    await toxiproxy.addBlackHoleToxics('redis');

    // Act — one command is written into the void.
    const startedAt = Date.now();
    const rejection = client.ping().then(
      () => 'resolved' as const,
      (error: Error) => error.message,
    );
    const message = await rejection;
    const elapsed = Date.now() - startedAt;

    // Assert — the caller is bounded by commandTimeout (rejection-only: no
    // cancellation, no socket change), and the client still considers itself
    // ready — the verified ioredis behavior that makes socketTimeout
    // necessary.
    expect(message).toBe('Command timed out');
    expect(elapsed).toBeGreaterThanOrEqual(CLIENT_COMMAND_TIMEOUT_MS);
    expect(elapsed).toBeLessThan(CLIENT_COMMAND_TIMEOUT_MS + 700);
    expect(client.status).toBe('ready');

    // A state-changing command written in this window has a genuinely
    // ambiguous outcome: it may or may not exist beyond the black hole.
    ambiguousIncrement = client.incr(COUNTER_KEY);
    ambiguousIncrement.catch(() => undefined);
  });

  it('destroys the silent socket at the socket deadline and fails fast while reconnecting', async () => {
    // Act — the socket deadline (2.5 s of silence) must end the "ready" lie:
    // ioredis destroys the stream and the bounded reconnect cycle starts.
    const status = await waitForStatus(client, (value) => value !== 'ready', 8000);

    // Assert — no longer ready; the client is closing or reconnecting.
    expect(['close', 'reconnecting', 'connecting', 'connect']).toContain(status);

    // While not ready, commands fail immediately (offline queue disabled) —
    // no caller waits the command timeout during the recovery window.
    const startedAt = Date.now();
    await expect(client.ping()).rejects.toThrow(/Stream isn't writeable/);
    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  it('never executes an ambiguous command twice and recovers after the fault clears', async () => {
    // Arrange — the fault is removed; the next reconnect attempt succeeds and
    // the client reaches "ready" without a restart.
    await toxiproxy.removeBlackHoleToxics('redis');
    await waitForStatus(client, (value) => value === 'ready', 15_000);

    // Act & Assert — the ambiguous INCR was rejected exactly once by the
    // command timeout (never replayed after reconnect).
    if (ambiguousIncrement) {
      await expect(ambiguousIncrement).rejects.toThrow(/Command timed out/);
      ambiguousIncrement = null;
    }

    // The ambiguous command executed AT MOST once server-side (never
    // duplicated), and the client serves commands again.
    const after = Number((await client.get(COUNTER_KEY)) ?? 0);
    expect(after).toBeGreaterThanOrEqual(0);
    expect(after).toBeLessThanOrEqual(1);
    await expect(client.ping()).resolves.toBe('PONG');
  });

  it('rejects commands issued while the client is not connected instead of queueing them', async () => {
    // Arrange — a second client whose dial cannot complete a handshake (the
    // toxics are already removed, so re-establish the fault for this scope).
    await toxiproxy.addBlackHoleToxics('redis');
    const deadClient = createRedisClient({
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
    try {
      // Act — the first command triggers the (lazy) connect and is issued
      // while the client is not yet writable.
      const startedAt = Date.now();
      const rejection = deadClient.ping().then(
        () => 'resolved' as const,
        (error: Error) => error.message,
      );
      const message = await rejection;

      // Assert — immediate fast failure, never an offline-queue wait.
      expect(message).toBe("Stream isn't writeable and enableOfflineQueue options is false");
      expect(Date.now() - startedAt).toBeLessThan(500);
    } finally {
      deadClient.disconnect();
      await toxiproxy.removeBlackHoleToxics('redis');
    }
  });
});
