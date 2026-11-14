import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';
import { I18nService } from '@nestjs/i18n';

import { RedisService } from './redis.service.js';

/**
 * Terminus health indicator for Redis. Redis is an optional dependency:
 * an unreachable Redis must not make the API look dead, so a failed probe
 * reports `degraded` (overall health status becomes `degraded`, HTTP stays
 * 200) instead of `down` (which would fail the check with 503).
 *
 * The probe is a PING on the shared client — no extra connections — and is
 * bounded by the client's `commandTimeout`.
 *
 * Client-facing responses carry only the generic, localized failure message:
 * `/health` is unauthenticated, and raw driver error text would let callers
 * fingerprint internal failure classes and disclose internal topology
 * (SEC-01/Wave-14 parity with the PostgreSQL indicator). Raw errors go to
 * the server-side log only.
 */
@Injectable()
export class RedisHealthIndicator {
  private readonly logger = new Logger(RedisHealthIndicator.name);

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly redisService: RedisService,
    private readonly i18n: I18nService,
  ) {}

  async check(): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check('redis');

    try {
      await this.redisService.ping();
      return indicator.up();
    } catch (error) {
      this.logger.warn({ err: error }, 'Redis health probe failed.');
      return indicator.degraded({ message: this.i18n.t('health.redisUnavailable') });
    }
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

    try {
      await this.redisService.ping();
      return indicator.up();
    } catch (error) {
      this.logger.warn({ err: error }, 'Redis health probe failed.');
      return indicator.down({ message: this.i18n.t('health.redisUnavailable') });
    }
  }
}
