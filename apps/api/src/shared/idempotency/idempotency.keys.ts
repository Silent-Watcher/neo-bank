import { createHash } from 'node:crypto';

import { buildRedisKey } from '#redis/redis-keys.js';

/**
 * Redis key for one idempotency record (ADR-039):
 * `neo-bank:idempotency:store:record:<sha256hex>`.
 *
 * The identifier is the SHA-256 digest of the package record key
 * (`<scope>:<client key>`), so the stored key is fixed-length, carries no
 * client-controlled content, and never exposes the phone number — the scope
 * within it is already an HMAC digest. The `{...}` hash-tagging used by the
 * throttler keys is unnecessary here: every script touches exactly one key,
 * so no two idempotency keys ever need to share a cluster slot.
 */
export function idempotencyRecordKey(recordKey: string): string {
  const digest = createHash('sha256').update(recordKey, 'utf8').digest('hex');

  return buildRedisKey({
    module: 'idempotency',
    feature: 'store',
    resource: 'record',
    identifier: digest,
  });
}
