import { Test } from '@nestjs/testing';
import { MikroORM } from '@mikro-orm/core';
import { PostgreSqlConnection } from '@mikro-orm/postgresql';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DatabaseHealthProbe } from './database.probe.js';

// The probe reaches the pool through the ADR-034 accessor, guarded by an
// `instanceof PostgreSqlConnection` check. The stub is built on the real
// prototype so the guard passes without constructing a driver connection;
// `getNativeClient` is shadowed with an own property.
function connectionStub(pool: PoolStub): PostgreSqlConnection {
  const connection = Object.create(PostgreSqlConnection.prototype) as PostgreSqlConnection;
  Object.assign(connection, { getNativeClient: () => Promise.resolve(pool) });
  return connection;
}

type ClientStub = {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
};

type PoolStub = {
  connect: ReturnType<typeof vi.fn>;
};

function createClient(queryImplementation?: () => Promise<unknown>): ClientStub {
  return {
    query: vi.fn(queryImplementation ?? (() => Promise.resolve({ rows: [{ '?column?': 1 }] }))),
    release: vi.fn(),
  };
}

async function createProbe(pool: PoolStub): Promise<DatabaseHealthProbe> {
  const module = await Test.createTestingModule({
    providers: [
      DatabaseHealthProbe,
      {
        provide: MikroORM,
        useValue: { em: { getConnection: () => connectionStub(pool) } },
      },
    ],
  }).compile();

  return module.get(DatabaseHealthProbe);
}

describe('DatabaseHealthProbe', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the transaction-scoped statement deadline probe and releases the client cleanly', async () => {
    // Arrange
    const client = createClient();
    const pool = { connect: vi.fn(async () => client) };
    const probe = await createProbe(pool);

    // Act
    const outcome = await probe.probe();

    // Assert — the probe statement carries the server-enforced deadline, and
    // a healthy client returns to the pool (release without an error).
    expect(outcome).toEqual({ ok: true });
    expect(client.query).toHaveBeenCalledWith(
      'BEGIN; SET LOCAL statement_timeout = 2000; SELECT 1; COMMIT',
    );
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith();
  });

  it('releases the client with the error and reports the failure when the query rejects', async () => {
    // Arrange
    const client = createClient(() => Promise.reject(new Error('boom')));
    const pool = { connect: vi.fn(async () => client) };
    const probe = await createProbe(pool);

    // Act
    const outcome = await probe.probe();

    // Assert — the errored release makes pg-pool remove the client.
    expect(outcome).toEqual({ ok: false, reason: 'boom' });
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith(expect.any(Error));
  });

  it('stringifies non-error rejections into the failure reason', async () => {
    // Arrange
    const client = createClient(() => Promise.reject('boom'));
    const pool = { connect: vi.fn(async () => client) };
    const probe = await createProbe(pool);

    // Act
    const outcome = await probe.probe();

    // Assert
    expect(outcome).toEqual({ ok: false, reason: 'boom' });
  });

  it('reports the acquisition failure without releasing anything', async () => {
    // Arrange — the pool acquisition itself fails (e.g. the dial timeout).
    const pool = {
      connect: vi.fn(async () => {
        throw new Error('Connection terminated due to connection timeout');
      }),
    };
    const probe = await createProbe(pool);

    // Act
    const outcome = await probe.probe();

    // Assert
    expect(outcome).toEqual({
      ok: false,
      reason: 'Connection terminated due to connection timeout',
    });
  });

  it('reclaims the client when the query never settles, within the deadline', async () => {
    // Arrange — a black-holed established connection: the query promise never
    // settles. Fake timers fire the deadline without real waiting.
    vi.useFakeTimers();
    const client = createClient(() => new Promise(() => undefined));
    const pool = { connect: vi.fn(async () => client) };
    const probe = await createProbe(pool);

    // Act
    const pending = probe.probe();
    await vi.advanceTimersByTimeAsync(3000);
    const outcome = await pending;

    // Assert — exactly one errored release; pg-pool evicts and force-
    // disconnects the client, which is what bounds the black-hole scenario.
    expect(outcome).toEqual({
      ok: false,
      reason: 'PostgreSQL probe timed out after 3000 ms',
    });
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith(expect.any(Error));
  });

  it('fails bounded while acquisition is still pending, without touching a client', async () => {
    // Arrange — the pool is exhausted and the queued acquisition never
    // resolves on its own.
    vi.useFakeTimers();
    const pool = { connect: vi.fn(() => new Promise(() => undefined)) };
    const probe = await createProbe(pool);

    // Act
    const pending = probe.probe();
    await vi.advanceTimersByTimeAsync(3000);
    const outcome = await pending;

    // Assert — no client was ever acquired, so there is nothing to release;
    // the pool's own acquisition timeout evicts the queued item.
    expect(outcome).toEqual({
      ok: false,
      reason: 'PostgreSQL probe timed out after 3000 ms',
    });
    expect(pool.connect).toHaveBeenCalledTimes(1);
  });

  it('returns a client whose acquisition settles after the deadline has fired', async () => {
    // Arrange — the acquisition is queued behind busy application clients and
    // resolves only after the probe deadline has fired (the pool's 5s
    // acquisition bound exceeds the 3s probe deadline).
    vi.useFakeTimers();
    const client = createClient();
    let releaseAcquisition!: () => void;
    const pool = {
      connect: vi.fn(
        () =>
          new Promise((resolve) => {
            releaseAcquisition = () => resolve(client);
          }),
      ),
    };
    const probe = await createProbe(pool);

    // Act
    const pending = probe.probe();
    await vi.advanceTimersByTimeAsync(3000);
    const outcome = await pending;
    releaseAcquisition();
    await vi.advanceTimersByTimeAsync(0);

    // Assert — the fresh client is returned immediately (never used for the
    // probe statement), so no pool slot leaks past the failed probe.
    expect(outcome).toEqual({
      ok: false,
      reason: 'PostgreSQL probe timed out after 3000 ms',
    });
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith();
    expect(client.query).not.toHaveBeenCalled();
  });

  it('shares one in-flight probe across concurrent callers', async () => {
    // Arrange
    vi.useFakeTimers();
    let releaseQuery!: () => void;
    const client = createClient(
      () =>
        new Promise<void>((resolve) => {
          releaseQuery = resolve;
        }),
    );
    const pool = { connect: vi.fn(async () => client) };
    const probe = await createProbe(pool);

    // Act — four concurrent probes (e.g. a request burst on liveness and
    // readiness) must coalesce into one database probe. The microtask that
    // starts the shared query needs to run before the deferred query can be
    // released.
    const pending = Promise.all([probe.probe(), probe.probe(), probe.probe(), probe.probe()]);
    await vi.advanceTimersByTimeAsync(0);
    releaseQuery();
    const results = await pending;

    // Assert
    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(results.every((result) => result === results[0])).toBe(true);
    expect(results[0]).toEqual({ ok: true });
  });

  it('serves the cached outcome within the success TTL and re-probes after expiry', async () => {
    // Arrange
    vi.useFakeTimers();
    const client = createClient();
    const pool = { connect: vi.fn(async () => client) };
    const probe = await createProbe(pool);

    // Act & Assert — a fresh probe populates the cache; every call inside the
    // TTL window reuses the cached outcome; expiry triggers a new probe.
    const first = await probe.probe();
    expect(pool.connect).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(4999);
    const second = await probe.probe();
    expect(second).toBe(first);
    expect(pool.connect).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    await probe.probe();
    expect(pool.connect).toHaveBeenCalledTimes(2);
  });

  it('serves the failure outcome during the cooldown and re-probes after it', async () => {
    // Arrange — the first probe fails; the next one (after the cooldown)
    // succeeds, proving a failure never blocks future probes.
    vi.useFakeTimers();
    const client = {
      query: vi
        .fn<() => Promise<unknown>>()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) };
    const probe = await createProbe(pool);

    // Act & Assert
    const first = await probe.probe();
    expect(first).toEqual({ ok: false, reason: 'boom' });
    expect(pool.connect).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2999);
    const second = await probe.probe();
    expect(second).toBe(first);
    expect(pool.connect).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    const third = await probe.probe();
    expect(third).toEqual({ ok: true });
    expect(pool.connect).toHaveBeenCalledTimes(2);
  });
});
