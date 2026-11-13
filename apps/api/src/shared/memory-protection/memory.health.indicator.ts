import { Injectable } from '@nestjs/common';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';
import { I18nService } from '@nestjs/i18n';

import { MemoryProtectionService } from './memory-protection.service.js';

/**
 * Terminus health indicator for the memory-protection state (ADR-026).
 *
 * Used exclusively by the readiness endpoint: while the protection state is
 * active the indicator reports `down`, which fails the readiness check with
 * HTTP 503 so an orchestrator stops routing new traffic to this instance.
 * The liveness endpoint deliberately does not include this indicator — a
 * memory-pressured process is still alive and must not be restarted.
 */
@Injectable()
export class MemoryHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly memoryProtection: MemoryProtectionService,
    private readonly i18n: I18nService,
  ) {}

  check(): HealthIndicatorResult {
    const indicator = this.healthIndicatorService.check('memory');

    if (this.memoryProtection.isProtected()) {
      return indicator.down({ message: this.i18n.t('health.memoryProtected') });
    }

    return indicator.up();
  }
}
