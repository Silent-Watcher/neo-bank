import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';

import { RedisHealthIndicator } from '#src/shared/redis/redis.health.js';

// VERSION_NEUTRAL keeps the health check out of URI versioning; its exclusion
// from the global 'api' prefix is applied in the bootstrap function (main.ts).
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly redisHealth: RedisHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      // Redis connection settings are mandatory, but the Redis server may be
      // unreachable: a failed probe degrades the overall status while HTTP
      // stays 200, so the process never looks dead because of Redis.
      () => this.redisHealth.check(),
    ]);
  }
}
