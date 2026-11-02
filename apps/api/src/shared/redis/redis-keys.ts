// Root namespace of every Redis key used by the application. Fixed
// centrally so no feature can invent its own top-level namespace.
const REDIS_KEY_ROOT = 'neo-bank';

export interface RedisKeyParts {
  /** Owning feature module (e.g. `enrollments`). */
  module: string;
  /** Feature within the module (e.g. `challenge`). */
  feature: string;
  /** Resource the key holds (e.g. `otp`). */
  resource: string;
  /** Unique identifier of the resource instance (e.g. the phone number). */
  identifier: string;
}

/**
 * Builds a hierarchical Redis key in the fixed application-wide pattern
 * `<app>:<module>:<feature>:<resource>:<identifier>` (all segments lowercase,
 * kebab-case where a segment needs multiple words).
 *
 * Keys must never be concatenated ad hoc; use this builder from a feature's
 * co-located keys file so each feature owns exactly one place defining its
 * keys (see the Redis key rule in the root AGENTS.md).
 */
export function buildRedisKey(parts: RedisKeyParts): string {
  return [REDIS_KEY_ROOT, parts.module, parts.feature, parts.resource, parts.identifier].join(':');
}
