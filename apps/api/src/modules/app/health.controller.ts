import { Controller, Get, HttpStatus, VERSION_NEUTRAL } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
// Both named global throttlers must be skipped explicitly: a bare
// @SkipThrottle() targets the "default" name only and would leave them active.
import { SkipThrottle } from '@nestjs/throttler';

import {
  problemDetailsSchema,
  successEnvelopeSchema,
} from '#src/shared/swagger/openapi.schemas.js';
import { RedisHealthIndicator } from '#src/shared/redis/redis.health.js';

// Response decorators are declared above @HealthCheck(): method decorators
// evaluate bottom-up, and Terminus's own @HealthCheck() registers a bare
// (unwrapped) health schema — ours must apply after it so the documented
// contract is the actual envelope-wrapped response.
@ApiTags('health')
@SkipThrottle({ short: true, long: true })
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly redisHealth: RedisHealthIndicator,
  ) {}

  @ApiOperation({
    summary: 'Application health probe',
    description:
      'Infrastructure probe outside the API prefix and versioning. The overall status is ok, degraded (e.g. Redis unreachable — HTTP stays 200), or error (HTTP 503).',
  })
  @ApiOkResponse({
    description: 'Terminus health result, wrapped in the standard response envelope.',
    schema: successEnvelopeSchema({
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['ok', 'degraded', 'error', 'shutting_down'] },
        info: {
          type: 'object',
          description:
            'Per-indicator results with status up or degraded, keyed by indicator name (e.g. redis).',
          additionalProperties: { type: 'object' },
        },
        error: {
          type: 'object',
          description: 'Per-indicator results with status down, keyed by indicator name.',
          additionalProperties: { type: 'object' },
        },
        details: {
          type: 'object',
          description: 'Every indicator result, keyed by indicator name.',
          additionalProperties: { type: 'object' },
        },
      },
      required: ['status', 'details'],
    }),
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: 'A critical indicator failed (overall status error), served as Problem Details.',
    schema: problemDetailsSchema,
  })
  @HealthCheck()
  @Get()
  check() {
    return this.health.check([
      // Redis connection settings are mandatory, but the Redis server may be
      // unreachable: a failed probe degrades the overall status while HTTP
      // stays 200, so the process never looks dead because of Redis.
      () => this.redisHealth.check(),
    ]);
  }
}
