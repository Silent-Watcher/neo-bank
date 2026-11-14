import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';
import { I18nService } from '@nestjs/i18n';
// Value import, not `import type`: the class identity is the DI token the
// integration registers, and NestJS needs it at runtime for constructor
// metadata.
import { MikroORM } from '@mikro-orm/core';

import { withTimeout } from './database.timeout.js';

// Bounds the probe: a PostgreSQL connection attempt has no built-in timeout
// (the pg pool's connectionTimeoutMillis bounds the dial itself at the pool
// level, see mikro-orm.options.ts), and an unreachable server must degrade
// health, never hang it. Deliberately below the Compose healthcheck timeout
// (5s): Terminus runs indicators concurrently, so worst-case liveness latency
// must fit inside the outer timeout — a probe that reached exactly 5s could
// mark a live container unhealthy.
const DATABASE_HEALTH_PROBE_TIMEOUT_MS = 3000;

/**
 * Terminus health indicator for PostgreSQL (ADR-027). PostgreSQL is an
 * optional dependency at runtime: an unreachable server must not make the API
 * look dead, so a failed probe reports `degraded` (overall status becomes
 * `degraded`, HTTP stays 200) instead of failing the check on the liveness
 * endpoint; the readiness endpoint uses the strict variant.
 *
 * The probe is a `select 1` through the ORM — no extra connections.
 *
 * Client-facing responses carry only the generic, localized failure message:
 * `/health` is unauthenticated, and raw driver error text would let callers
 * fingerprint internal failure classes (authentication vs. refusal vs.
 * timeout) and disclose the database name and internal topology (SEC-01,
 * Wave 14). Raw reasons and errors go to the server-side log only.
 */
@Injectable()
export class DatabaseHealthIndicator {
  private readonly logger = new Logger(DatabaseHealthIndicator.name);

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly orm: MikroORM,
    private readonly i18n: I18nService,
  ) {}

  /**
   * Liveness variant (`GET /health`): a failed probe degrades the overall
   * status while HTTP stays 200, so the process never looks dead because of
   * PostgreSQL. A timeout is reported like any other failure.
   */
  async check(): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check('postgres');

    try {
      const result = await this.probe();

      if (result.ok) {
        return indicator.up();
      }
      this.logger.warn(
        { reason: result.reason },
        'PostgreSQL health probe reported a failed connection.',
      );
      return indicator.degraded({ message: this.i18n.t('health.databaseUnavailable') });
    } catch (error) {
      this.logger.warn({ err: error }, 'PostgreSQL health probe failed.');
      return indicator.degraded({ message: this.i18n.t('health.databaseUnavailable') });
    }
  }

  /**
   * Strict variant for the readiness endpoint (`GET /health/ready`, ADR-026
   * semantics): an unreachable PostgreSQL reports `down` — the readiness
   * check must fail with HTTP 503. The liveness endpoint keeps using
   * `check()` (degraded, HTTP 200) so the process never looks dead because
   * of the database. A timeout is reported like any other failure.
   */
  async checkReady(): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check('postgres');

    try {
      const result = await this.probe();

      if (result.ok) {
        return indicator.up();
      }
      this.logger.warn(
        { reason: result.reason },
        'PostgreSQL health probe reported a failed connection.',
      );
      return indicator.down({ message: this.i18n.t('health.databaseUnavailable') });
    } catch (error) {
      this.logger.warn({ err: error }, 'PostgreSQL health probe failed.');
      return indicator.down({ message: this.i18n.t('health.databaseUnavailable') });
    }
  }

  // MikroORM v7 initializes without connecting and checkConnection() only
  // probes an established connection, so the probe connects first when
  // needed. connect() is unconditional and idempotent (the Kysely client is
  // created once and reused): isConnected() would itself run a `select 1`,
  // doubling the probe's query cost for no benefit. The probe is bounded by
  // the shared timeout helper (see database.timeout.ts) so an unreachable
  // server surfaces as a normal failure, never a hung endpoint.
  private async probe(): Promise<{ ok: true } | { ok: false; reason: string }> {
    return withTimeout(
      async () => {
        await this.orm.connect();

        return this.orm.checkConnection();
      },
      DATABASE_HEALTH_PROBE_TIMEOUT_MS,
      'PostgreSQL probe',
    );
  }
}
