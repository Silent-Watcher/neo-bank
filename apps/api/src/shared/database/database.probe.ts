import { Injectable, Logger } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/core';
import { PostgreSqlConnection } from '@mikro-orm/postgresql';

// The `pg` connection pool and its borrowed clients, as returned by the
// public documented `PostgreSqlConnection.getNativeClient()` accessor
// (ADR-034 access pattern). The aliases derive from the driver's own
// declaration, so the application never imports `pg` directly; pg ships no
// bundled type declarations and no @types/pg is installed, so — exactly as
// in database.lifecycle.ts — the aliases stay intentionally loose.
type PgPool = Awaited<ReturnType<PostgreSqlConnection['getNativeClient']>>;
type PgClient = Awaited<ReturnType<PgPool['connect']>>;

// Bounds the probe: a PostgreSQL connection attempt has no built-in timeout
// (the pg pool's connectionTimeoutMillis bounds the dial itself at the pool
// level, see mikro-orm.options.ts), and an unreachable server must degrade
// health, never hang it. The deadline covers acquisition AND execution, so
// worst-case liveness latency stays below the Compose healthcheck timeout
// (5s) exactly as before.
const DATABASE_HEALTH_PROBE_TIMEOUT_MS = 3000;

// Server-enforced statement deadline for the probe query (ADR-036): the
// server aborts the statement itself when reachable, so a genuinely slow
// backend is bounded independently of the client-side deadline. Strictly
// below the probe deadline so the server, not the client, is what surfaces
// the failure whenever the network still works.
const DATABASE_PROBE_STATEMENT_TIMEOUT_MS = 2000;

// Health probes are coalesced (ADR-036): one in-flight probe per instance,
// results cached briefly so a request flood cannot amplify into database
// work. The failure cooldown doubles as the outage probe interval — a failed
// probe is never cached beyond this window, so recovery is detected on the
// next probe after expiry.
const DATABASE_HEALTH_CACHE_SUCCESS_TTL_MS = 5000;
const DATABASE_HEALTH_CACHE_FAILURE_TTL_MS = 3000;

// The probe statement: a transaction-scoped, server-enforced statement
// deadline around a trivial query. `SET LOCAL` reverts at COMMIT, so no
// session state leaks into the next borrower of the pooled client. The
// values are fixed named constants — no external input reaches this string.
const DATABASE_PROBE_STATEMENT = `BEGIN; SET LOCAL statement_timeout = ${DATABASE_PROBE_STATEMENT_TIMEOUT_MS}; SELECT 1; COMMIT`;

export type DatabaseProbeOutcome = { ok: true } | { ok: false; reason: string };

/**
 * Runs the database health probe with hard client-side and server-side
 * bounds, single-flight coalescing, and a short-lived result cache (ADR-036).
 *
 * The probe borrows one client from the ORM's existing pg pool through
 * public APIs (the ADR-034 access pattern) instead of `orm.checkConnection()`:
 * a query that hangs on a silently-dead established connection (network
 * black hole) never settles on its own, and neither pg's `query_timeout`,
 * nor Kysely's clean release, nor MikroORM's abort strategies reclaim the
 * checked-out client in that scenario (all verified against the installed
 * sources). The reclaim path here is the one mechanism that does not depend
 * on any packet reaching the database: the 3s deadline releases the client
 * with an error, which makes pg-pool remove it and force-disconnect it
 * locally (pg's documented hung-query path in `Client.end()`), rejecting the
 * pending query and freeing the pool slot immediately.
 *
 * Shutdown needs no dedicated hook: once the ORM pool ends, `pool.connect()`
 * rejects, and an in-flight probe self-terminates within the deadline.
 */
@Injectable()
export class DatabaseHealthProbe {
  private readonly logger = new Logger(DatabaseHealthProbe.name);

  /** Last probe outcome with its expiry; success and failure TTLs differ. */
  private cache: { outcome: DatabaseProbeOutcome; expiresAt: number } | null = null;

  /** Shared in-flight probe — the single-flight guard. */
  private inflight: Promise<DatabaseProbeOutcome> | null = null;

  constructor(private readonly orm: MikroORM) {}

  /**
   * Returns the current database reachability outcome. Concurrent callers
   * share one probe; results within the TTL window are served from the
   * cache. Outcomes are frozen at creation — the same reference reaches
   * every concurrent caller, so they must not (and cannot) be mutated.
   */
  async probe(): Promise<DatabaseProbeOutcome> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.outcome;
    }
    if (this.inflight) {
      return this.inflight;
    }
    const flight = this.runBoundedProbe().finally(() => {
      this.inflight = null;
    });
    this.inflight = flight;
    return flight;
  }

  // One probe run: bounded borrow + query, then cache the outcome. Failures
  // (including the deadline) are logged here once per probe, never per
  // request — the cooldown keeps both the probe rate and the log rate
  // bounded during an outage.
  private async runBoundedProbe(): Promise<DatabaseProbeOutcome> {
    try {
      await this.runProbeQuery();
      // Frozen: the same object reference reaches every concurrent caller on
      // both health endpoints, so immutability must be a property of the
      // data, not a convention (SEC-01, Wave 24).
      const outcome: DatabaseProbeOutcome = Object.freeze({ ok: true });
      this.cache = { outcome, expiresAt: Date.now() + DATABASE_HEALTH_CACHE_SUCCESS_TTL_MS };
      return outcome;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const outcome: DatabaseProbeOutcome = Object.freeze({ ok: false, reason });
      this.cache = { outcome, expiresAt: Date.now() + DATABASE_HEALTH_CACHE_FAILURE_TTL_MS };
      this.logger.warn({ reason }, 'PostgreSQL health probe failed.');
      return outcome;
    }
  }

  // Borrows a client from the ORM pool, runs the probe statement, and
  // releases the client exactly once on every path — pg-pool throws on
  // double release, the deadline callback can race a query that settles at
  // the same moment, and an acquisition that resolves after the deadline
  // already fired must return its fresh client immediately. The thrown error
  // carries the deadline message when the deadline fired, so the logged
  // reason reflects the actual failure.
  private async runProbeQuery(): Promise<void> {
    let client: PgClient | null = null;
    let released = false;
    let timeoutError: Error | null = null;
    let timer: NodeJS.Timeout | undefined;

    const releaseOnce = (error?: Error): void => {
      if (released) {
        return;
      }
      released = true;
      // A clean release returns the client to the pool; the errored release
      // makes pg-pool evict it. The arg-less form keeps the healthy path
      // exactly on the documented API shape.
      if (client) {
        if (error) {
          client.release(error);
        } else {
          client.release();
        }
      }
    };

    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timeoutError = new Error(
          `PostgreSQL probe timed out after ${DATABASE_HEALTH_PROBE_TIMEOUT_MS} ms`,
        );
        releaseOnce(timeoutError);
        reject(timeoutError);
      }, DATABASE_HEALTH_PROBE_TIMEOUT_MS);
    });

    const work = async (): Promise<void> => {
      const pool = await this.getPool();
      const borrowed = await pool.connect();
      client = borrowed;
      // The deadline may have fired while this acquisition was still queued
      // (the pool's own 5s acquisition bound exceeds the probe deadline): the
      // race has already rejected, and releaseOnce has already spent its
      // single release — so return the fresh client directly (no query has
      // run, a clean release is safe) instead of leaking the pool slot.
      if (released) {
        borrowed.release();
        return;
      }
      await borrowed.query(DATABASE_PROBE_STATEMENT);
    };

    try {
      // Promise.race subscribes to both promises, so a late rejection from
      // the losing side (e.g. the pool's own acquisition timeout after the
      // deadline already fired) can never surface as an unhandled rejection.
      await Promise.race([work(), deadline]);
      clearTimeout(timer);
      releaseOnce();
    } catch (error) {
      clearTimeout(timer);
      releaseOnce(error instanceof Error ? error : new Error(String(error)));
      throw timeoutError ?? error;
    }
  }

  // ADR-034 access pattern: the pool comes from the public documented
  // accessor. `getNativeClient()` only creates the pool lazily (no dial) —
  // the dial happens at `pool.connect()` below, which is what the deadline
  // bounds.
  private async getPool(): Promise<PgPool> {
    const connection = this.orm.em.getConnection();
    if (!(connection instanceof PostgreSqlConnection)) {
      throw new Error(
        `The PostgreSQL health probe supports only the PostgreSQL connection; found ${connection.constructor.name}.`,
      );
    }
    return connection.getNativeClient();
  }
}
