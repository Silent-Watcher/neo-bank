import { Injectable, Logger, Optional } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/core';

import { withTimeout } from './database.timeout.js';

// Retry limits for the initial PostgreSQL connection (ADR-027 amendment).
// Named constants instead of environment variables: the values are engineering
// decisions, not deployment configuration, and tests inject their own.
const DATABASE_CONNECT_MAX_ATTEMPTS = 5; // including the first attempt
const DATABASE_CONNECT_BASE_DELAY_MS = 1000; // 1s, doubles per retry
const DATABASE_CONNECT_DELAY_CAP_MS = 8000; // 4th retry waits 8s, not 16s
const DATABASE_CONNECT_ATTEMPT_TIMEOUT_MS = 5000;

// pg surfaces server-side failures with a SQLSTATE `code`. These classes are
// configuration or authentication problems — retrying cannot fix them, so the
// initializer fails immediately instead of burning the retry budget.
// Everything else (ECONNREFUSED, timeouts, DNS, transient network errors)
// is treated as temporary and retried.
const PERMANENT_CONNECTION_SQLSTATES = new Set([
  '28P01', // invalid_password
  '28000', // invalid_authorization_specification
  '3D000', // invalid_catalog_name (database does not exist)
]);

function isPermanentConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === 'string' && PERMANENT_CONNECTION_SQLSTATES.has(code);
}

/**
 * Overridable retry limits. Production uses the named constants above; tests
 * inject small values so retry scenarios run in milliseconds.
 */
export interface DatabaseConnectOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  delayCapMs?: number;
  attemptTimeoutMs?: number;
}

/**
 * Establishes the initial PostgreSQL connection during application bootstrap
 * (ADR-027 amendment): bounded retries for temporary failures, immediate
 * failure on permanent configuration/authentication errors, and startup
 * failure when all attempts are exhausted — the application never serves
 * HTTP without its required database, and no infinite retry loop exists.
 *
 * Uses the officially supported `orm.connect()` API on the single ORM
 * instance; no second MikroORM instance and no bypass of the database module.
 * After a successful boot, reconnection behavior is the pg pool's own
 * per-acquisition logic — nothing here retries queries or transactions.
 */
@Injectable()
export class DatabaseConnectionInitializer implements OnApplicationBootstrap {
  private readonly logger = new Logger(DatabaseConnectionInitializer.name);

  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly delayCapMs: number;
  private readonly attemptTimeoutMs: number;

  constructor(
    private readonly orm: MikroORM,
    // Optional() keeps Nest from trying to resolve the plain options object
    // as a DI token; the default below supplies the production constants.
    @Optional()
    options: DatabaseConnectOptions = {},
  ) {
    this.maxAttempts = options.maxAttempts ?? DATABASE_CONNECT_MAX_ATTEMPTS;
    this.baseDelayMs = options.baseDelayMs ?? DATABASE_CONNECT_BASE_DELAY_MS;
    this.delayCapMs = options.delayCapMs ?? DATABASE_CONNECT_DELAY_CAP_MS;
    this.attemptTimeoutMs = options.attemptTimeoutMs ?? DATABASE_CONNECT_ATTEMPT_TIMEOUT_MS;
  }

  async onApplicationBootstrap(): Promise<void> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        await withTimeout(
          async () => {
            // connect() is idempotent and cheap; the actual server contact is
            // verified explicitly through checkConnection() so the attempt's
            // contract does not depend on the driver's implicit
            // ensureDatabase side effect (the Migrator extension dials the
            // server during connect in the current version — this makes that
            // behavior deliberate instead of incidental).
            await this.orm.connect();

            const result = await this.orm.checkConnection();
            if (!result.ok) {
              throw result.error ?? new Error(result.reason);
            }
          },
          this.attemptTimeoutMs,
          'PostgreSQL connection attempt',
        );
        if (attempt > 1) {
          this.logger.log(`PostgreSQL connection established on attempt ${attempt}.`);
        } else {
          this.logger.log('PostgreSQL connection established.');
        }
        return;
      } catch (error) {
        if (isPermanentConnectionError(error)) {
          this.logger.error(
            { err: error },
            'PostgreSQL connection failed with a permanent configuration or authentication error; not retrying.',
          );
          throw error;
        }

        this.logger.warn(
          { err: error, attempt, maxAttempts: this.maxAttempts },
          'PostgreSQL connection attempt failed.',
        );
        if (attempt === this.maxAttempts) {
          throw new Error(
            `PostgreSQL connection failed after ${this.maxAttempts} attempts: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        }
        await this.waitBeforeRetry(attempt);
      }
    }
  }

  // The delay timer is unref'd: a termination signal during the backoff window
  // must not be held hostage by a pending retry.
  private async waitBeforeRetry(failedAttempt: number): Promise<void> {
    const delayMs = Math.min(this.baseDelayMs * 2 ** (failedAttempt - 1), this.delayCapMs);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, delayMs);
      timer.unref();
    });
  }
}
