import { Injectable, Logger } from '@nestjs/common';
import type { BeforeApplicationShutdown } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/core';
import { PostgreSqlConnection } from '@mikro-orm/postgresql';

import { DatabaseConnectionInitializer } from './database.connect.js';

/**
 * The `pg` connection pool, as returned by the public documented
 * `PostgreSqlConnection.getNativeClient()` accessor. The type is inferred
 * from the driver's own declaration — `pg` is not a direct dependency, so
 * the application never imports it.
 */
type PgPool = Awaited<ReturnType<PostgreSqlConnection['getNativeClient']>>;

/**
 * Observes the PostgreSQL connection pool and logs its lifecycle events
 * through the application logger (ADR-034). Registration happens strictly
 * after {@link DatabaseConnectionInitializer} established the boot
 * connection: the constructor dependency on the initializer is a real DI
 * edge, which Nest resolves first and which orders the bootstrap hooks
 * sequentially (same-level providers would run concurrently) — the public
 * `getNativeClient()` awaits `ensureConnection()`, so this provider must
 * never be the caller that dials the database.
 *
 * MikroORM 7.2.9 exposes no connection lifecycle event API; the pool events
 * (node-postgres' own documented EventEmitter surface) are the supported
 * observation point. Only pool-level events are used: `'connect'` (a new
 * physical connection) and `'error'` (an idle-client or pool error). The
 * per-acquisition `'acquire'`/`'release'` events are deliberately skipped
 * (per-query noise), and client-level errors stay with the driver's own
 * internal handlers.
 *
 * Listener cleanup runs in `beforeApplicationShutdown` — before
 * `@mikro-orm/nestjs` closes the ORM in `onApplicationShutdown` — so no
 * handler outlives its owner; the ORM keeps sole ownership of closing the
 * connection.
 */
@Injectable()
export class DatabaseLifecycleLogger implements BeforeApplicationShutdown {
  private readonly logger = new Logger(DatabaseLifecycleLogger.name);

  /** Non-null exactly while the listeners are registered — the idempotency guard. */
  private pool: PgPool | null = null;

  // Stable references so `off()` removes exactly what `on()` registered.
  private readonly onPoolConnect = (): void => {
    this.logger.log('New PostgreSQL connection established.');
  };

  private readonly onPoolError = (error: Error): void => {
    this.logger.warn({ err: error }, 'PostgreSQL connection pool error.');
  };

  // The `DatabaseConnectionInitializer` parameter is the sequencing edge:
  // Nest instantiates it first and orders the bootstrap hooks after it. It
  // exposes no runtime API this provider needs to call.
  constructor(
    private readonly orm: MikroORM,
    private readonly connectionInitializer: DatabaseConnectionInitializer,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.pool) {
      return;
    }
    if (!(await this.orm.isConnected())) {
      this.logger.warn(
        'PostgreSQL is not connected; connection lifecycle logging was not registered.',
      );
      return;
    }
    const connection = this.orm.em.getConnection();
    if (!(connection instanceof PostgreSqlConnection)) {
      this.logger.warn(
        `Connection lifecycle logging supports only the PostgreSQL connection; found ${connection.constructor.name}.`,
      );
      return;
    }
    const pool = await connection.getNativeClient();
    pool.on('connect', this.onPoolConnect);
    pool.on('error', this.onPoolError);
    this.pool = pool;
    this.logger.log('PostgreSQL connection lifecycle logging registered.');
  }

  async beforeApplicationShutdown(): Promise<void> {
    if (!this.pool) {
      return;
    }
    this.pool.off('connect', this.onPoolConnect);
    this.pool.off('error', this.onPoolError);
    this.pool = null;
    this.logger.log('PostgreSQL connection lifecycle logging removed.');
  }
}
