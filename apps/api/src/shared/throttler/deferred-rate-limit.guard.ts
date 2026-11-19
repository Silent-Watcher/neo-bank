import type { ExecutionContext } from '@nestjs/common';

import { DEFERRED_RATE_LIMIT_KEY } from './deferred-rate-limit.decorator.js';
import { RedisThrottlerGuard } from './redis-throttler.guard.js';

/**
 * The global rate-limit guard (ADR-015) with one addition for deferred routes
 * (ADR-039): a route marked {@link DeferredRateLimit} is skipped here entirely
 * — replays and in-flight idempotency duplicates must not consume quota —
 * because its enforcement moves to a route-level interceptor that runs after
 * the idempotency acquire gate. Every other route takes the unchanged
 * `RedisThrottlerGuard` path (same policies, storage, key generation, and
 * response headers).
 */
export class DeferredRateLimitGuard extends RedisThrottlerGuard {
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const deferred = this.reflector.getAllAndOverride<boolean>(DEFERRED_RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (deferred) {
      return true;
    }
    return super.canActivate(context);
  }
}
