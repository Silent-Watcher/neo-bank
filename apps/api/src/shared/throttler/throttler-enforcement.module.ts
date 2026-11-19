import { Module } from '@nestjs/common';

import { throttlerModule } from './throttler.module.js';
import { RedisThrottlerGuard } from './redis-throttler.guard.js';

/**
 * Shared enforcement plumbing for deferred rate-limit routes (ADR-039): makes
 * a `RedisThrottlerGuard` instance injectable outside the global guard
 * pipeline, so a route-level interceptor (e.g. `DeferredRateLimitInterceptor`)
 * can re-enforce the route's quota after the idempotency acquire gate.
 *
 * Feature modules import this module — never provide throttler infrastructure
 * themselves — and reference `DeferredRateLimitInterceptor` by class on the
 * deferred routes. The throttler module is imported by the same DynamicModule
 * reference `AppModule` uses, so Nest registers it once and both guard
 * instances (the global `DeferredRateLimitGuard` and this exported one) share
 * the same storage, options, and policy configuration.
 */
@Module({
  imports: [throttlerModule],
  providers: [RedisThrottlerGuard],
  exports: [RedisThrottlerGuard],
})
export class ThrottlerEnforcementModule {}
