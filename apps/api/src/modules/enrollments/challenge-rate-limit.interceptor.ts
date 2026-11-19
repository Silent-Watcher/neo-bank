import { Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';

import { RedisThrottlerGuard } from '#src/shared/throttler/redis-throttler.guard.js';

/**
 * Route-level rate-limit enforcement for POST /enrollments/challenge
 * (ADR-039): the route is marked `@DeferredRateLimit()`, so the global guard
 * skips it, and this interceptor re-enforces the exact same quota after the
 * idempotency acquire gate — inside the global IdempotencyInterceptor, so a
 * completed replay and an in-flight `409 IDEMPOTENCY_KEY_IN_USE` rejection
 * never reach it and consume no quota.
 *
 * The enforcement itself is not reimplemented: it delegates to the official
 * `ThrottlerGuard.canActivate` of a `RedisThrottlerGuard` instance (provided
 * by the enrollments module), which reads the route's `@Throttle` metadata
 * and runs the same storage, named policies, key generation, response
 * headers, and throttling exception as the global guard does for every other
 * route.
 */
@Injectable()
export class ChallengeRateLimitInterceptor implements NestInterceptor {
  constructor(private readonly throttlerGuard: RedisThrottlerGuard) {}

  intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    return this.throttlerGuard.canActivate(context).then(() => next.handle());
  }
}
