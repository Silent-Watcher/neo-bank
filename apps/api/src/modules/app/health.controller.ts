import {
  Controller,
  Get,
  HttpStatus,
  ServiceUnavailableException,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { I18nService } from '@nestjs/i18n';
// Both named global throttlers must be skipped explicitly: a bare
// @SkipThrottle() targets the "default" name only and would leave them active.
import { SkipThrottle } from '@nestjs/throttler';

import {
  problemDetailsSchema,
  successEnvelopeSchema,
} from '#src/shared/swagger/openapi.schemas.js';
import { RedisHealthIndicator } from '#src/shared/redis/redis.health.js';
import { MemoryHealthIndicator } from '#src/shared/memory-protection/memory.health.indicator.js';
import { SkipMemoryProtection } from '#src/shared/memory-protection/skip-memory-protection.decorator.js';

// Both probe endpoints document the same Terminus payload wrapped in the
// standard response envelope, so the schema object is built once.
const terminusEnvelopeSchema = successEnvelopeSchema({
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
});

// Response decorators are declared above @HealthCheck(): method decorators
// evaluate bottom-up, and Terminus's own @HealthCheck() registers a bare
// (unwrapped) health schema — ours must apply after it so the documented
// contract is the actual envelope-wrapped response.
@ApiTags('health')
@SkipThrottle({ short: true, long: true })
@SkipMemoryProtection()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly redisHealth: RedisHealthIndicator,
    private readonly memoryHealth: MemoryHealthIndicator,
    private readonly i18n: I18nService,
  ) {}

  @ApiOperation({
    summary: 'Application liveness probe',
    description:
      'Infrastructure probe outside the API prefix and versioning. The overall status is ok, degraded (e.g. Redis unreachable — HTTP stays 200), or error (HTTP 503). Deliberately independent of the memory-protection state: a memory-pressured process is still alive and must not be restarted.',
  })
  @ApiOkResponse({
    description: 'Terminus health result, wrapped in the standard response envelope.',
    schema: terminusEnvelopeSchema,
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

  @ApiOperation({
    summary: 'Application readiness probe',
    description:
      'Reports whether this instance should currently receive traffic (ADR-026). Returns 503 while memory protection is active (memory indicator down) or while Redis is unreachable (strict redis indicator down), 200 otherwise. Orchestrators remove the instance from routing on 503; direct traffic is rejected by the memory protection guard.',
  })
  @ApiOkResponse({
    description: 'All readiness indicators are up; wrapped in the standard response envelope.',
    schema: terminusEnvelopeSchema,
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description:
      'At least one readiness indicator is down (memory protection active or Redis unreachable), served as Problem Details.',
    schema: problemDetailsSchema,
  })
  @HealthCheck()
  @Get('ready')
  async checkReady() {
    try {
      return await this.health.check([
        // Strict Redis reporting: an unreachable Redis fails readiness (503),
        // because Redis-backed routes cannot be served. The liveness endpoint
        // reports the same outage as degraded (200) on purpose.
        () => this.redisHealth.checkReady(),
        // Memory protection active → down → 503 (ADR-026).
        () => this.memoryHealth.check(),
      ]);
    } catch (error) {
      // Terminus signals a failed readiness check by throwing a bare
      // ServiceUnavailableException whose payload is the framework's health
      // aggregate — an untranslated framework phrase would end up as the
      // Problem Details detail. Rethrow with the localized detail; the filter
      // supplies the localized title and the stable SERVICE_UNAVAILABLE code.
      if (error instanceof ServiceUnavailableException) {
        throw new ServiceUnavailableException(this.i18n.t('health.notReady'));
      }
      throw error;
    }
  }
}
