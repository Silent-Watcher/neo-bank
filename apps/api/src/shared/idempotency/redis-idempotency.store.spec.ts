import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IdempotencyStorage } from '@nestjs/idempotency';

// Unit tests must not depend on ambient environment state; the store's import
// chain reaches the env validation layer through the Redis module, so the
// validated environment is replaced with a fully valid one.
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

import type { RedisClient } from '#redis/redis.module.js';

import { RedisIdempotencyStore } from './redis-idempotency.store.js';

// Unit tests for the reply-narrowing and contract-boundary behavior of the
// Redis idempotency store. The Lua scripts themselves (atomicity, takeover,
// expiry) are proven against a real Redis server by the contract suite in
// test/redis-idempotency-store.redis-spec.ts — mocks cannot prove scripts.

const client = {
  defineCommand: vi.fn<(name: string, definition: { numberOfKeys: number; lua: string }) => void>(),
  idempotencyAcquire:
    vi.fn<(key: string, owner: string, fp: string, lockTtl: number) => Promise<unknown>>(),
  idempotencyComplete:
    vi.fn<(key: string, owner: string, resp: string, ttl: number) => Promise<unknown>>(),
  idempotencyRelease: vi.fn<(key: string, owner: string) => Promise<unknown>>(),
  idempotencyExtend: vi.fn<(key: string, owner: string, lockTtl: number) => Promise<unknown>>(),
};
const storage = { registerSource: vi.fn<(source: unknown) => void>() };

let store: RedisIdempotencyStore;

beforeEach(() => {
  vi.clearAllMocks();
  store = new RedisIdempotencyStore(
    client as unknown as RedisClient,
    storage as unknown as IdempotencyStorage,
  );
});

describe('RedisIdempotencyStore', () => {
  it('registers its four scripts as named commands and itself as the package store source', () => {
    // Assert
    const registeredNames = client.defineCommand.mock.calls.map((call) => call[0]);
    expect(registeredNames).toEqual([
      'idempotencyAcquire',
      'idempotencyComplete',
      'idempotencyRelease',
      'idempotencyExtend',
    ]);
    for (const call of client.defineCommand.mock.calls) {
      expect(call[1]).toMatchObject({ numberOfKeys: 1 });
    }
    expect(storage.registerSource).toHaveBeenCalledTimes(1);
    expect(storage.registerSource).toHaveBeenCalledWith(store);
  });

  it('maps the acquire replies to the package acquire results', async () => {
    // Arrange — acquired
    client.idempotencyAcquire.mockResolvedValue([1]);
    await expect(store.acquire('k', 'owner', 'fp', 60_000)).resolves.toEqual({
      state: 'acquired',
    });

    // Arrange — live in-flight lock
    client.idempotencyAcquire.mockResolvedValue([0, 'stored-fp']);
    await expect(store.acquire('k', 'owner', 'fp', 60_000)).resolves.toEqual({
      state: 'in-flight',
      fingerprint: 'stored-fp',
    });
  });

  it('reads a bodyless completed record back with an undefined body', async () => {
    // Arrange — the endpoint's empty 202 is stored as a payload whose body is
    // omitted by JSON.stringify and must round-trip to undefined, not null.
    client.idempotencyAcquire.mockResolvedValue([2, 'stored-fp', '{"status":202,"headers":{}}']);

    // Act
    const result = await store.acquire('k', 'owner', 'fp', 60_000);

    // Assert
    expect(result).toEqual({
      state: 'completed',
      fingerprint: 'stored-fp',
      response: { status: 202, headers: {}, body: undefined },
    });
    expect((result as { response: { body?: unknown } }).response.body).toBeUndefined();
  });

  it('passes a sealed payload through without looking inside it', async () => {
    // Arrange
    client.idempotencyAcquire.mockResolvedValue([2, 'stored-fp', '{"sealed":"v1.a.b.c.d"}']);

    // Act + Assert
    await expect(store.acquire('k', 'owner', 'fp', 60_000)).resolves.toEqual({
      state: 'completed',
      fingerprint: 'stored-fp',
      response: { sealed: 'v1.a.b.c.d' },
    });
  });

  it('fails closed on malformed replies and unreadable completed records', async () => {
    // Arrange — reply shapes the scripts can never legitimately produce.
    client.idempotencyAcquire.mockResolvedValue([3]);
    await expect(store.acquire('k', 'owner', 'fp', 60_000)).rejects.toThrow(
      'Unexpected Redis idempotency script reply.',
    );

    client.idempotencyAcquire.mockResolvedValue('not-an-array');
    await expect(store.acquire('k', 'owner', 'fp', 60_000)).rejects.toThrow(
      'Unexpected Redis idempotency script reply.',
    );

    // A completed record without a readable fingerprint or payload.
    client.idempotencyAcquire.mockResolvedValue([0, null]);
    await expect(store.acquire('k', 'owner', 'fp', 60_000)).rejects.toThrow(
      'Idempotency record is unreadable',
    );

    client.idempotencyAcquire.mockResolvedValue([2, 'stored-fp', null]);
    await expect(store.acquire('k', 'owner', 'fp', 60_000)).rejects.toThrow(
      'Idempotency record is unreadable',
    );

    client.idempotencyAcquire.mockResolvedValue([2, 'stored-fp', 'not-json']);
    await expect(store.acquire('k', 'owner', 'fp', 60_000)).rejects.toThrow(
      'Idempotency record is unreadable',
    );

    client.idempotencyAcquire.mockResolvedValue([2, 'stored-fp', '{"nope":true}']);
    await expect(store.acquire('k', 'owner', 'fp', 60_000)).rejects.toThrow(
      'Idempotency record is unreadable',
    );
  });

  it('maps complete/release/extend integer replies to booleans and rejects anything else', async () => {
    // Arrange
    client.idempotencyComplete.mockResolvedValue(1);
    client.idempotencyRelease.mockResolvedValue(0);
    client.idempotencyExtend.mockResolvedValue(1);

    // Act + Assert
    await expect(
      store.complete('k', 'owner', { status: 202, headers: {}, body: undefined }, 86_400_000),
    ).resolves.toBe(true);
    await expect(store.release('k', 'owner')).resolves.toBe(false);
    await expect(store.extend('k', 'owner', 60_000)).resolves.toBe(true);

    client.idempotencyRelease.mockResolvedValue('garbage');
    await expect(store.release('k', 'owner')).rejects.toThrow(
      'Unexpected Redis idempotency script reply.',
    );
  });

  it('hands whole-millisecond durations to the scripts and rejects invalid ones before any call', async () => {
    // Act + Assert — fractional, zero, and negative durations fail fast.
    for (const invalid of [0, 1.5, Number.NaN, -1000]) {
      await expect(store.acquire('k', 'owner', 'fp', invalid)).rejects.toThrow(
        'Idempotency durations must be whole milliseconds of at least 1.',
      );
      await expect(store.extend('k', 'owner', invalid)).rejects.toThrow(
        'Idempotency durations must be whole milliseconds of at least 1.',
      );
    }
    await expect(
      store.complete('k', 'owner', { status: 202, headers: {}, body: undefined }, 0),
    ).rejects.toThrow('Idempotency durations must be whole milliseconds of at least 1.');
    expect(client.idempotencyAcquire).not.toHaveBeenCalled();
    expect(client.idempotencyExtend).not.toHaveBeenCalled();
    expect(client.idempotencyComplete).not.toHaveBeenCalled();

    // Act — a valid duration is forwarded unchanged.
    client.idempotencyAcquire.mockResolvedValue([1]);
    await store.acquire('k', 'owner', 'fp', 60_000);
    expect(client.idempotencyAcquire.mock.calls[0][3]).toBe(60_000);
  });

  it('builds the hashed namespaced record key deterministically', async () => {
    // Arrange
    client.idempotencyAcquire.mockResolvedValue([1]);

    // Act
    await store.acquire('scope-key', 'owner', 'fp', 60_000);

    // Assert — fixed namespace, fixed length, no client-controlled content.
    expect(client.idempotencyAcquire.mock.calls[0][0]).toMatch(
      /^neo-bank:idempotency:store:record:[0-9a-f]{64}$/,
    );
    const firstKey = client.idempotencyAcquire.mock.calls[0][0];
    client.idempotencyAcquire.mockClear();
    await store.acquire('scope-key', 'owner2', 'fp', 60_000);
    expect(client.idempotencyAcquire.mock.calls[0][0]).toBe(firstKey);
  });

  it('serializes the stored payload with JSON.stringify on complete', async () => {
    // Arrange
    client.idempotencyComplete.mockResolvedValue(1);
    const payload = { status: 202, headers: {}, body: undefined };

    // Act
    await store.complete('k', 'owner', payload, 86_400_000);

    // Assert — a bodyless payload round-trips without a body key.
    expect(client.idempotencyComplete.mock.calls[0][2]).toBe('{"status":202,"headers":{}}');
  });
});
