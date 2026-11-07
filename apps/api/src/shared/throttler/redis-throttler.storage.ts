import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Redis } from 'ioredis';

import { throttleBlockKey, throttleHitKey } from './throttler.keys.js';

// Shape of the official ThrottlerStorageRecord (not re-exported by the
// package index): times are in seconds, input TTLs in milliseconds.
interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

// One atomic rate-limit decision: check the active block, count the request,
// apply the block policy, and compute all expirations in a single Lua
// execution so concurrent requests and multiple API instances can never
// interleave read/modify/write steps.
//
// The block state is evaluated BEFORE the hit counter is incremented: while a
// block is active, requests neither increment nor recreate the counter, so a
// blocked client cannot rearm a stale counter that would block it again right
// after the advertised Retry-After (the known nest-lab issue #74 flaw).
//
// ARGV: 1 = ttl (ms), 2 = limit, 3 = blockDuration (ms)
// Returns: { totalHits, timeToExpire (ms), isBlocked (0/1), timeToBlockExpire (ms) }
const INCREMENT_SCRIPT = `
local hitKey = KEYS[1]
local blockKey = KEYS[2]
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local blockDuration = tonumber(ARGV[3])

local isBlocked = redis.call('GET', blockKey)
if isBlocked then
  local blockedHits = redis.call('GET', hitKey)
  local blockedTimeToExpire = redis.call('PTTL', hitKey)
  return {
    blockedHits and tonumber(blockedHits) or 0,
    blockedTimeToExpire > 0 and blockedTimeToExpire or 0,
    1,
    redis.call('PTTL', blockKey)
  }
end

local totalHits = redis.call('INCR', hitKey)
local timeToExpire = redis.call('PTTL', hitKey)
if timeToExpire <= 0 then
  redis.call('PEXPIRE', hitKey, ttl)
  timeToExpire = ttl
end

if totalHits > limit then
  if blockDuration > 0 then
    redis.call('SET', blockKey, '1', 'PX', blockDuration)
    -- The counter expires with the block, so no stale counter survives into
    -- the post-block window and no request is blocked twice for one burst.
    redis.call('PEXPIRE', hitKey, blockDuration)
    return { totalHits, blockDuration, 1, blockDuration }
  end
  -- Zero or negative block duration is a deliberate no-block policy: reject
  -- on the counter alone and never send an invalid expiration to Redis.
  return { totalHits, timeToExpire, 1, timeToExpire }
end

return { totalHits, timeToExpire, 0, 0 }
`;

// The storage contract reports times in seconds while Redis answers in
// milliseconds; convert with ceiling so a client can never retry earlier
// than the actual expiration.
function toSeconds(milliseconds: number): number {
  return Math.ceil(milliseconds / 1000);
}

function toNumber(value: unknown, field: string): number {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  // Accept numeric strings too: ioredis clients built with stringNumbers
  // reply with strings for Lua integer returns.
  if (typeof value === 'string' && value !== '' && Number.isInteger(Number(value))) {
    return Number(value);
  }
  throw new Error(`Redis throttler script returned an invalid ${field}: ${String(value)}`);
}

/**
 * Redis-backed {@link ThrottlerStorage} for the global rate limiter. Runs the
 * decision logic as one atomic Lua script on the application's single shared
 * ioredis connection; it never opens a connection and never closes the one it
 * receives — lifecycle stays with the owning RedisModule/RedisService.
 *
 * The counter is a fixed window whose TTL starts with the first hit; when a
 * block is created the counter window is synchronized with the block duration
 * (documented in ADR-015).
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly client: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    // Already part of the official generated key; the hit and block keys
    // cannot collide between named throttlers.
    _throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    // throttlerName is already part of the official generated key; the hit
    // and block keys cannot collide between named throttlers.
    const result: unknown = await this.client.eval(
      INCREMENT_SCRIPT,
      2,
      throttleHitKey(key),
      throttleBlockKey(key),
      ttl,
      limit,
      blockDuration,
    );

    if (!Array.isArray(result) || result.length !== 4) {
      throw new Error(`Redis throttler script returned an unexpected result: ${String(result)}`);
    }

    const totalHits = toNumber(result[0], 'totalHits');
    const timeToExpireMs = toNumber(result[1], 'timeToExpire');
    const isBlocked = toNumber(result[2], 'isBlocked');
    const timeToBlockExpireMs = toNumber(result[3], 'timeToBlockExpire');

    return {
      totalHits,
      timeToExpire: toSeconds(timeToExpireMs),
      isBlocked: isBlocked === 1,
      timeToBlockExpire: toSeconds(timeToBlockExpireMs),
    };
  }
}
