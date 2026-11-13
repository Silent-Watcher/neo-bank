import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { I18nService } from '@nestjs/i18n';
import type { FastifyReply } from 'fastify';
import { Reflector } from '@nestjs/core';

import { SKIP_MEMORY_PROTECTION } from './memory-protection.constants.js';
import { MemoryProtectionService } from './memory-protection.service.js';

/**
 * Global admission guard for memory-based load shedding (ADR-026).
 *
 * Registered before the Redis-backed throttler guard so that a protected
 * process rejects requests through the cheapest possible path — no Redis
 * round trip, no quota bookkeeping. While the protection state is active,
 * non-exempt requests receive 503 Problem Details (the existing filter
 * normalizes the thrown exception) with a `Retry-After` header pointing at
 * the next sample. Health probes and the Problem-Type documentation page
 * opt out via @SkipMemoryProtection().
 *
 * The detail is localized here, at the throw site, per the error-response
 * convention; the filter localizes the title.
 */
@Injectable()
export class MemoryProtectionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly memoryProtection: MemoryProtectionService,
    private readonly i18n: I18nService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.memoryProtection.isProtected()) {
      return true;
    }

    const isExempt = this.reflector.getAllAndOverride<boolean>(SKIP_MEMORY_PROTECTION, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isExempt) {
      return true;
    }

    const response = context.switchToHttp().getResponse<FastifyReply>();
    response.header('Retry-After', String(this.memoryProtection.getSecondsUntilNextSample()));
    throw new ServiceUnavailableException(this.i18n.t('errors.details.serviceOverloaded'));
  }
}
