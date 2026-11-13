import { Injectable } from '@nestjs/common';
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
 */
@Injectable()
export class RedisHealthIndicator {
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
      return indicator.degraded({ message: this.failureMessage(error) });
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
      return indicator.down({ message: this.failureMessage(error) });
    }
  }

  // Error messages from ioredis reference host/port (e.g.
  // "connect ECONNREFUSED 127.0.0.1:6379"), never credentials or the
  // full URL, so they are safe diagnostics for the health response.
  // Those raw technical messages pass through untranslated; only the
  // fallback for a non-Error failure is localized.
  private failureMessage(error: unknown): string {
    return error instanceof Error ? error.message : this.i18n.t('health.redisUnavailable');
  }
}
