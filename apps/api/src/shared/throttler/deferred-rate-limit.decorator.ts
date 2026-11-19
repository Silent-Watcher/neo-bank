import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key marking a route whose rate-limit enforcement is deferred to a
 * downstream layer (ADR-039): the global throttler guard skips the route so
 * replays and in-flight idempotency duplicates never reach it, and a
 * route-level interceptor re-enforces the exact same quota after the
 * idempotency acquire gate.
 */
export const DEFERRED_RATE_LIMIT_KEY = 'neo-bank:deferred-rate-limit';

export function DeferredRateLimit(): MethodDecorator {
  return SetMetadata(DEFERRED_RATE_LIMIT_KEY, true);
}
