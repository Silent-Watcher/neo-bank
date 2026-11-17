import { Injectable } from '@nestjs/common';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';
import { I18nService } from '@nestjs/i18n';

import { RedisHealthProbe } from './redis.probe.js';

/**
 * Terminus health indicator for Redis. Redis is an optional dependency:
 * an unreachable Redis must not make the API look dead, so a failed probe
 * reports `degraded` (overall health status becomes `degraded`, HTTP stays
 * 200) instead of `down` (which would fail the check with 503).
 *
 * The probe itself lives in {@link RedisHealthProbe} (ADR-037): bounded,
 * single-flight, and briefly cached, so a request flood on the unauthenticated
 * health endpoints cannot amplify into Redis commands. Failures — including
 * the probe deadline — are logged by the probe engine once per probe, never
 * per request; this indicator only maps the outcome.
 *
 * Client-facing responses carry only the generic, localized failure message:
 * `/health` is unauthenticated, and raw driver error text would let callers
 * fingerprint internal failure classes and disclose internal topology
 * (SEC-01/Wave-14 parity with the PostgreSQL indicator). Raw errors go to
 * the server-side log only.
 */
@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly redisProbe: RedisHealthProbe,
    private readonly i18n: I18nService,
  ) {}

  async check(): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check('redis');
    const result = await this.redisProbe.probe();

    if (result.ok) {
      return indicator.up();
    }
    return indicator.degraded({ message: this.i18n.t('health.redisUnavailable') });
  }

  /**
   * Strict variant for the readiness endpoint (ADR-026): an unreachable Redis
   * reports `down` — the readiness check must fail with HTTP 503, because a
   * Redis-backed instance cannot serve guarded routes. The liveness endpoint
   * keeps using `check()` (degraded, HTTP 200) so the process never looks
   * dead because of Redis.
   */
  async checkReady(): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check('redis');
    const result = await this.redisProbe.probe();

    if (result.ok) {
      return indicator.up();
    }
    return indicator.down({ message: this.i18n.t('health.redisUnavailable') });
  }
}
