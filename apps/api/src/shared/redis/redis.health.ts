import { Injectable } from '@nestjs/common';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';

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
  ) {}

  async check(): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check('redis');

    try {
      await this.redisService.ping();
      return indicator.up();
    } catch (error) {
      // Error messages from ioredis reference host/port (e.g.
      // "connect ECONNREFUSED 127.0.0.1:6379"), never credentials or the
      // full URL, so they are safe diagnostics for the health response.
      return indicator.degraded({
        message: error instanceof Error ? error.message : 'Redis is unavailable.',
      });
    }
  }
}
