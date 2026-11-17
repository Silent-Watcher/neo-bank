import { MikroORM } from '@mikro-orm/core';
import { PostgreSqlDriver, PostgreSqlConnection } from '@mikro-orm/postgresql';
import { Network } from 'testcontainers';
import type { StartedNetwork } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DatabaseHealthProbe } from '#database/database.probe.js';
import { buildMikroOrmOptions } from '#database/mikro-orm.options.js';

import { startTestPostgres, TestToxiproxy } from './testcontainers.js';
import type { TestPostgres } from './testcontainers.js';

// Database health probe integration tier (ADR-036): exercises the probe
// engine against a real PostgreSQL server. The unit under test is the probe
// mechanism itself (bounded borrow, server-enforced statement deadline,
// eviction, recovery), so the spec initializes a minimal ORM directly instead
// of booting the whole AppModule — the wired endpoint behavior is covered by
// the e2e health specs, and the coalescing/cache mechanics by the unit spec.
// Each probe uses a fresh DatabaseHealthProbe instance so the process-local
// cache never masks the database work under test.
//
// The black-hole scenarios run through Toxiproxy on an explicit shared
// container network: the proxy forwards to PostgreSQL by network alias, and
// the test process connects through the proxy's host-mapped port.

// Pool capacity for the probe orms — small so pool-exhaustion behavior is
// observable with a handful of clients.
const TEST_POOL_MAX = 2;
// Dedicated single-capacity pool for the maximum-concurrency test.
const TEST_POOL_MAX_ONE = 1;

// The per-test statement deadlines ride on `SET LOCAL`, so the runtime
// default (30s) stays in place here to reproduce the real pool shape.
const TEST_STATEMENT_TIMEOUT_MS = 30_000;

let network: StartedNetwork;
let postgres: TestPostgres;
let toxiproxy: TestToxiproxy;
let directUrl: string;

// Three container/network starts exceed Vitest's default 10s hook timeout;
// the explicit timeouts keep one slow image start from cascading into the
// teardown (the hook continues running after a timeout, which made the
// afterAll below tear down half-started state).
beforeAll(async () => {
  network = await new Network().start();
  ({ postgres, url: directUrl } = await startTestPostgres({
    network,
    networkAlias: 'postgres',
  }));
  toxiproxy = new TestToxiproxy();
  await toxiproxy.start({ network });
  // The proxy listens inside the container network and forwards to the
  // PostgreSQL alias; test-process clients reach it through the mapped
  // port.
  await toxiproxy.createProxy('postgres', 'postgres', 5432);
}, 120_000);

afterAll(async () => {
  // Guarded: a failed beforeAll (e.g. an image pull) must not mask its own
  // error with a teardown TypeError, and the remaining resources must still
  // reach their own teardown.
  if (postgres) await postgres.stop();
  if (toxiproxy) await toxiproxy.stop();
  if (network) await network.stop();
}, 60_000);

function poolOf(orm: MikroORM) {
  const connection = orm.em.getConnection() as PostgreSqlConnection;
  return connection.getNativeClient();
}

describe('DatabaseHealthProbe against direct PostgreSQL', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init({
      driver: PostgreSqlDriver,
      ...buildMikroOrmOptions<PostgreSqlDriver>({
        clientUrl: directUrl,
        poolMax: TEST_POOL_MAX,
        statementTimeoutMs: TEST_STATEMENT_TIMEOUT_MS,
      }),
      // The probe needs no entities; the discovery warning opt-out is the
      // supported way to run an entity-less ORM instance.
      discovery: { warnWhenNoEntities: false },
    });
  });

  afterAll(async () => {
    // Guarded: a failed beforeAll must not mask its own error with a
    // teardown TypeError.
    if (orm) await orm.close(true);
  });

  it('probes successfully and returns the client to the pool', async () => {
    // Arrange & Act
    const outcome = await new DatabaseHealthProbe(orm).probe();

    // Assert
    expect(outcome).toEqual({ ok: true });
  });

  it('aborts a statement server-side at the transaction-scoped statement_timeout', async () => {
    // Arrange — the mechanism the probe statement relies on: within the
    // BEGIN/COMMIT window, PostgreSQL itself kills an over-long statement.
    const pool = await poolOf(orm);
    const client = await pool.connect();

    // Act & Assert
    const startedAt = Date.now();
    await expect(
      client.query('BEGIN; SET LOCAL statement_timeout = 500; SELECT pg_sleep(2)'),
    ).rejects.toThrow(/statement timeout/);
    const elapsed = Date.now() - startedAt;
    expect(elapsed).toBeLessThan(2000);

    // Cleanup — the aborted transaction left the client in an aborted state;
    // the errored release removes it from the pool (the same path a failed
    // probe takes).
    client.release(new Error('statement timed out — evicting'));
  });

  it('lets a statement complete inside the statement_timeout window', async () => {
    // Arrange — the previous test's errored release removed its client; the
    // pool dials a fresh one here.
    const pool = await poolOf(orm);
    const client = await pool.connect();

    // Act & Assert
    await expect(
      client.query('BEGIN; SET LOCAL statement_timeout = 500; SELECT pg_sleep(0.05); COMMIT'),
    ).resolves.toBeDefined();
    client.release();
  });

  it('recovers with a working client after an errored release removed one', async () => {
    // Arrange — the errored release from the deadline/failure path must never
    // leave the pool unable to serve the next borrower.
    const pool = await poolOf(orm);

    // Act — acquire a client, fail its query, evict it with an error.
    const client = await pool.connect();
    await expect(
      client.query('BEGIN; SET LOCAL statement_timeout = 200; SELECT pg_sleep(1)'),
    ).rejects.toThrow(/statement timeout/);
    client.release(new Error('statement timed out — evicting'));

    // Assert — the next acquisition works on a replacement client.
    const replacement = await pool.connect();
    const result = await replacement.query('SELECT 1');
    expect(result.rows).toHaveLength(1);
    replacement.release();
  });

  it('caps concurrent acquisitions at the configured pool maximum', async () => {
    // Arrange — a single-capacity pool: the second acquisition must queue
    // until the first client is released (deterministic: pg-pool cannot dial
    // past `max`, so the second acquisition cannot settle before the release).
    const maxOneOrm = await MikroORM.init({
      driver: PostgreSqlDriver,
      ...buildMikroOrmOptions<PostgreSqlDriver>({
        clientUrl: directUrl,
        poolMax: TEST_POOL_MAX_ONE,
        statementTimeoutMs: TEST_STATEMENT_TIMEOUT_MS,
      }),
      // See the direct-PostgreSQL describe above: no entities required.
      discovery: { warnWhenNoEntities: false },
    });
    try {
      const pool = await poolOf(maxOneOrm);
      const first = await pool.connect();
      let secondSettled = false;
      // pg ships no type declarations, so the acquired-client shape is
      // annotated explicitly here (release-only — all this test needs).
      const second = pool.connect().then((acquired: { release: (error?: Error) => void }) => {
        secondSettled = true;
        return acquired;
      });

      // Act & Assert
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(secondSettled).toBe(false);
      first.release();
      const secondClient = await second;
      expect(secondSettled).toBe(true);
      secondClient.release();
    } finally {
      await maxOneOrm.close(true);
    }
  });
});

describe('DatabaseHealthProbe through the Toxiproxy black hole', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    const { host, port } = toxiproxy.getProxyEndpoint();
    const proxyUrl = new URL(directUrl);
    proxyUrl.hostname = host;
    proxyUrl.port = String(port);
    orm = await MikroORM.init({
      driver: PostgreSqlDriver,
      ...buildMikroOrmOptions<PostgreSqlDriver>({
        clientUrl: proxyUrl.toString(),
        poolMax: TEST_POOL_MAX,
        statementTimeoutMs: TEST_STATEMENT_TIMEOUT_MS,
      }),
      // See the direct-PostgreSQL describe above: no entities required.
      discovery: { warnWhenNoEntities: false },
    });
  });

  afterAll(async () => {
    // Guarded: a failed beforeAll must not mask its own error with a
    // teardown TypeError.
    if (orm) await orm.close(true);
  });

  it('probes successfully through the proxy before the fault', async () => {
    // Arrange & Act & Assert — establishes a pooled client whose connection
    // traverses the proxy.
    const outcome = await new DatabaseHealthProbe(orm).probe();
    expect(outcome).toEqual({ ok: true });
  });

  it('reclaims the black-holed client within the deadline and recovers after the fault clears', async () => {
    // Arrange — activate the exact attack scenario: the established
    // connection keeps running while every packet is silently dropped in both
    // directions. The server-side statement abort (2s) never reaches the
    // client, so only the local reclaim path can end the probe.
    const pool = await poolOf(orm);
    expect(pool.totalCount).toBeGreaterThan(0);
    await toxiproxy.addBlackHoleToxics('postgres');

    // Act — the probe must fail bounded, not hang.
    const startedAt = Date.now();
    const outcome = await new DatabaseHealthProbe(orm).probe();
    const elapsed = Date.now() - startedAt;

    // Assert — bounded failure, exactly the deadline (3s) plus overhead.
    expect(outcome).toEqual({
      ok: false,
      reason: expect.stringContaining('timed out after 3000 ms'),
    });
    expect(elapsed).toBeLessThan(4500);

    // The borrowed client was released with an error and evicted: the pool
    // holds no clients anymore.
    expect(pool.totalCount).toBe(0);

    // Recovery — with the fault removed, the pool dials a fresh client
    // through the proxy and the probe succeeds again (no permanent damage).
    await toxiproxy.removeBlackHoleToxics('postgres');
    const recovered = await new DatabaseHealthProbe(orm).probe();
    expect(recovered).toEqual({ ok: true });
  });
});
