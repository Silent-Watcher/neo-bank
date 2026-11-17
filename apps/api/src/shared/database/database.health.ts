import { Injectable } from '@nestjs/common';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';
import { I18nService } from '@nestjs/i18n';

import { DatabaseHealthProbe } from './database.probe.js';

/**
 * Terminus health indicator for PostgreSQL (ADR-027). PostgreSQL is an
 * optional dependency at runtime: an unreachable server must not make the API
 * look dead, so a failed probe reports `degraded` (overall status becomes
 * `degraded`, HTTP stays 200) instead of failing the check on the liveness
 * endpoint; the readiness endpoint uses the strict variant.
 *
 * The probe itself lives in {@link DatabaseHealthProbe} (ADR-036): bounded,
 * single-flight, and briefly cached, so a request flood on the unauthenticated
 * health endpoints cannot amplify into database work. Failures — including
 * the probe deadline — are logged by the probe engine once per probe, never
 * per request; this indicator only maps the outcome.
 *
 * Client-facing responses carry only the generic, localized failure message:
 * `/health` is unauthenticated, and raw driver error text would let callers
 * fingerprint internal failure classes (authentication vs. refusal vs.
 * timeout) and disclose the database name and internal topology (SEC-01,
 * Wave 14). Raw reasons and errors go to the server-side log only.
 */
@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly databaseProbe: DatabaseHealthProbe,
    private readonly i18n: I18nService,
  ) {}

  /**
   * Liveness variant (`GET /health`): a failed probe degrades the overall
   * status while HTTP stays 200, so the process never looks dead because of
   * PostgreSQL. A timeout is reported like any other failure.
   */
  async check(): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check('postgres');
    const result = await this.databaseProbe.probe();

    if (result.ok) {
      return indicator.up();
    }
    return indicator.degraded({ message: this.i18n.t('health.databaseUnavailable') });
  }

  /**
   * Strict variant for the readiness endpoint (`GET /health/ready`, ADR-026
   * semantics): an unreachable PostgreSQL reports `down` — the readiness
   * check must fail with HTTP 503. The liveness endpoint keeps using
   * `check()` (degraded, HTTP 200) so the process never looks dead because of
   * the database. A timeout is reported like any other failure.
   */
  async checkReady(): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check('postgres');
    const result = await this.databaseProbe.probe();

    if (result.ok) {
      return indicator.up();
    }
    return indicator.down({ message: this.i18n.t('health.databaseUnavailable') });
  }
}
