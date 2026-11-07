import { buildRedisKey } from '#src/shared/redis/redis-keys.js';

/**
 * Redis keys for one rate-limit evaluation:
 * `neo-bank:throttler:rate-limit:hit:{<key>}` and
 * `neo-bank:throttler:rate-limit:block:{<key>}`.
 *
 * `key` is the sha256 identity produced by the official ThrottlerGuard key
 * generation (handler + controller + throttler name + tracker). The
 * `{...}` hash tag around the identifier keeps the hit and block keys in the
 * same Redis Cluster hash slot so the two-key Lua script stays valid if the
 * deployment ever moves to Redis Cluster.
 */
export function throttleHitKey(key: string): string {
  return buildRedisKey({
    module: 'throttler',
    feature: 'rate-limit',
    resource: 'hit',
    identifier: `{${key}}`,
  });
}

export function throttleBlockKey(key: string): string {
  return buildRedisKey({
    module: 'throttler',
    feature: 'rate-limit',
    resource: 'block',
    identifier: `{${key}}`,
  });
}
