import { Injectable } from '@nestjs/common';
import { IdempotencyStorage } from '@nestjs/idempotency';
import type {
  IdempotencyAcquireResult,
  IdempotencySealedResponse,
  IdempotencyStoredPayload,
  IdempotencyStoredResponse,
  IdempotencyStore,
} from '@nestjs/idempotency';

import { InjectRedis } from '#redis/redis.module.js';
import type { RedisClient } from '#redis/redis.module.js';
import { isRecord } from '#http/http-boundary.js';

import { idempotencyRecordKey } from './idempotency.keys.js';

// Lua script integer reply codes for ACQUIRE (the other three scripts return
// plain 0/1 booleans). ioredis delivers integer replies as JavaScript
// numbers: `stringNumbers` is never enabled (see redis-options.ts) and the
// provider builds exactly one client type, so the reply type is a fixed
// contract — anything else is a programming error and fails fast.
const ACQUIRE_REPLY_IN_FLIGHT = 0;
const ACQUIRE_REPLY_ACQUIRED = 1;
const ACQUIRE_REPLY_COMPLETED = 2;

const MALFORMED_RECORD_ERROR =
  'Idempotency record is unreadable (missing or malformed stored data).';
const UNEXPECTED_REPLY_ERROR = 'Unexpected Redis idempotency script reply.';

// One atomic acquire (ADR-039): create the in-flight lock when no valid
// record exists, report a live in-flight lock or a completed record, and take
// over an expired lock or record. Reading the state, checking expiry, and
// writing the takeover happen inside one script execution, so of any number
// of concurrent callers exactly one wins a free or expired key.
//
// The record is a hash: `state` ('in-flight' | 'completed'), `fp`
// (fingerprint), `owner` (in-flight only), `resp` (completed only — the
// JSON-serialized stored payload). Expiry is the whole-record PEXPIRE.
//
// KEYS[1] = record key
// ARGV[1] = owner (per-attempt fencing token), ARGV[2] = fingerprint,
// ARGV[3] = lock TTL in whole milliseconds
// Returns: {1} acquired (created or taken over), {0, fp} live in-flight,
// {2, fp, resp} completed.
const ACQUIRE_SCRIPT = `
local state = redis.call('HGET', KEYS[1], 'state')
if not state then
  redis.call('HSET', KEYS[1], 'state', 'in-flight', 'fp', ARGV[2], 'owner', ARGV[1])
  redis.call('PEXPIRE', KEYS[1], ARGV[3])
  return {1}
end
if state == 'in-flight' then
  if redis.call('PTTL', KEYS[1]) > 0 then
    return {0, redis.call('HGET', KEYS[1], 'fp')}
  end
elseif state == 'completed' then
  if redis.call('PTTL', KEYS[1]) > 0 then
    return {2, redis.call('HGET', KEYS[1], 'fp'), redis.call('HGET', KEYS[1], 'resp')}
  end
else
  return redis.error_reply('idempotency-record-malformed')
end
-- Expired lock or record: take over as a fresh in-flight lock. The write
-- runs under the same script execution that observed the expiry, so of any
-- number of concurrent takers exactly one wins.
redis.call('HSET', KEYS[1], 'state', 'in-flight', 'fp', ARGV[2], 'owner', ARGV[1])
redis.call('HDEL', KEYS[1], 'resp')
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return {1}
`;

// One atomic complete: turn the caller's live in-flight lock into a completed
// record only when the caller still owns it. A stale owner (lock expired and
// taken over, record already completed) changes nothing.
//
// KEYS[1] = record key
// ARGV[1] = owner, ARGV[2] = stored payload (JSON), ARGV[3] = record TTL in
// whole milliseconds
// Returns: 1 = completed, 0 = ownership/state/expiry check failed.
const COMPLETE_SCRIPT = `
local state = redis.call('HGET', KEYS[1], 'state')
if state ~= 'in-flight' then
  return 0
end
if redis.call('HGET', KEYS[1], 'owner') ~= ARGV[1] then
  return 0
end
if redis.call('PTTL', KEYS[1]) <= 0 then
  return 0
end
redis.call('HSET', KEYS[1], 'state', 'completed', 'resp', ARGV[2])
redis.call('HDEL', KEYS[1], 'owner')
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return 1
`;

// One atomic release: delete the record only when it is still the caller's
// live in-flight lock. Completed records are never released and a stale
// owner never deletes a newer request's lock.
//
// KEYS[1] = record key
// ARGV[1] = owner
// Returns: 1 = released, 0 = ownership/state/expiry check failed.
const RELEASE_SCRIPT = `
local state = redis.call('HGET', KEYS[1], 'state')
if state ~= 'in-flight' then
  return 0
end
if redis.call('HGET', KEYS[1], 'owner') ~= ARGV[1] then
  return 0
end
if redis.call('PTTL', KEYS[1]) <= 0 then
  return 0
end
redis.call('UNLINK', KEYS[1])
return 1
`;

// One atomic extend (the package's lock heartbeat): renew the expiry only for
// the caller's live in-flight lock. Renewing a completed record would cut its
// record TTL down to the lock TTL, and renewing a taken-over lock would keep
// a dead request's lock alive — both are refused.
//
// KEYS[1] = record key
// ARGV[1] = owner, ARGV[2] = lock TTL in whole milliseconds
// Returns: 1 = extended, 0 = ownership/state/expiry check failed.
const EXTEND_SCRIPT = `
local state = redis.call('HGET', KEYS[1], 'state')
if state ~= 'in-flight' then
  return 0
end
if redis.call('HGET', KEYS[1], 'owner') ~= ARGV[1] then
  return 0
end
if redis.call('PTTL', KEYS[1]) <= 0 then
  return 0
end
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1
`;

// The four scripts are registered once on the shared client as named custom
// commands (ioredis defineCommand): no dynamic script execution per call,
// and ioredis manages the EVALSHA/EVAL fallback itself. The augmentation
// gives the generated methods their exact signatures app-wide.
declare module 'ioredis' {
  interface Redis {
    idempotencyAcquire(
      key: string,
      owner: string,
      fingerprint: string,
      lockTtl: number,
    ): Promise<unknown>;
    idempotencyComplete(
      key: string,
      owner: string,
      response: string,
      ttl: number,
    ): Promise<unknown>;
    idempotencyRelease(key: string, owner: string): Promise<unknown>;
    idempotencyExtend(key: string, owner: string, lockTtl: number): Promise<unknown>;
  }
}

function isStoredResponse(value: unknown): value is IdempotencyStoredResponse {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.status === 'number' && Number.isInteger(value.status) && isRecord(value.headers)
  );
}

function isSealedResponse(value: unknown): value is IdempotencySealedResponse {
  return isRecord(value) && typeof value.sealed === 'string';
}

// The stored payload is JSON-safe by contract and was written by this store;
// a read-back that does not parse into one of the two payload shapes means
// the record is corrupt. Failing closed keeps an operation the record proves
// happened from being re-executed; the record expires with its TTL.
function parseStoredPayload(raw: string): IdempotencyStoredPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(MALFORMED_RECORD_ERROR);
  }
  if (isSealedResponse(parsed) || isStoredResponse(parsed)) {
    return parsed;
  }
  throw new Error(MALFORMED_RECORD_ERROR);
}

// The package hands whole milliseconds (at least 1) down; assert the contract
// at the boundary so a fractional or missing duration can never reach
// PEXPIRE as an invalid expiration.
function wholeMilliseconds(value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('Idempotency durations must be whole milliseconds of at least 1.');
  }
  return value;
}

// Narrowing helper for the three 0/1 scripts: only the integer replies 1 and
// 0 are accepted, so a malformed reply fails the call fast instead of
// silently masquerading as a false negative.
function booleanReply(result: unknown): boolean {
  if (result === 1) {
    return true;
  }
  if (result === 0) {
    return false;
  }
  throw new Error(UNEXPECTED_REPLY_ERROR);
}

/**
 * Redis-backed {@link IdempotencyStore} for the official @nestjs/idempotency
 * module (ADR-039). Every operation is one atomic Lua script on exactly one
 * record key, running on the application's single shared ioredis connection:
 * it never opens a connection and never closes the one it receives — the
 * lifecycle stays with the owning RedisModule/RedisService. Records are not
 * silently evictable (deployment prerequisite: `maxmemory-policy noeviction`)
 * and there is no in-memory fallback: a Redis failure fails the request
 * closed, bounded by the shared client's ADR-037 command timeout.
 */
@Injectable()
export class RedisIdempotencyStore implements IdempotencyStore {
  constructor(
    @InjectRedis() private readonly client: RedisClient,
    storage: IdempotencyStorage,
  ) {
    client.defineCommand('idempotencyAcquire', { numberOfKeys: 1, lua: ACQUIRE_SCRIPT });
    client.defineCommand('idempotencyComplete', { numberOfKeys: 1, lua: COMPLETE_SCRIPT });
    client.defineCommand('idempotencyRelease', { numberOfKeys: 1, lua: RELEASE_SCRIPT });
    client.defineCommand('idempotencyExtend', { numberOfKeys: 1, lua: EXTEND_SCRIPT });
    storage.registerSource(this);
  }

  async acquire(
    key: string,
    owner: string,
    fingerprint: string,
    lockTtl: number,
  ): Promise<IdempotencyAcquireResult> {
    const result: unknown = await this.client.idempotencyAcquire(
      idempotencyRecordKey(key),
      owner,
      fingerprint,
      wholeMilliseconds(lockTtl),
    );

    if (!Array.isArray(result) || result.length < 1 || result.length > 3) {
      throw new Error(UNEXPECTED_REPLY_ERROR);
    }
    const [reply, storedFingerprint, storedResponse] = result;

    if (reply === ACQUIRE_REPLY_ACQUIRED) {
      return { state: 'acquired' };
    }
    if (reply === ACQUIRE_REPLY_IN_FLIGHT) {
      if (typeof storedFingerprint !== 'string') {
        throw new Error(MALFORMED_RECORD_ERROR);
      }
      return { state: 'in-flight', fingerprint: storedFingerprint };
    }
    if (reply === ACQUIRE_REPLY_COMPLETED) {
      if (typeof storedFingerprint !== 'string' || typeof storedResponse !== 'string') {
        throw new Error(MALFORMED_RECORD_ERROR);
      }
      return {
        state: 'completed',
        fingerprint: storedFingerprint,
        response: parseStoredPayload(storedResponse),
      };
    }
    throw new Error(UNEXPECTED_REPLY_ERROR);
  }

  async complete(
    key: string,
    owner: string,
    response: IdempotencyStoredPayload,
    ttl: number,
  ): Promise<boolean> {
    const result = await this.client.idempotencyComplete(
      idempotencyRecordKey(key),
      owner,
      JSON.stringify(response),
      wholeMilliseconds(ttl),
    );
    return booleanReply(result);
  }

  async release(key: string, owner: string): Promise<boolean> {
    const result = await this.client.idempotencyRelease(idempotencyRecordKey(key), owner);
    return booleanReply(result);
  }

  async extend(key: string, owner: string, lockTtl: number): Promise<boolean> {
    const result = await this.client.idempotencyExtend(
      idempotencyRecordKey(key),
      owner,
      wholeMilliseconds(lockTtl),
    );
    return booleanReply(result);
  }
}
