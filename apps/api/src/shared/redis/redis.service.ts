import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';

import type { RedisConfig } from '#config/redis.config.js';
import { REDIS_CONFIG } from '#config/redis.config.js';

import type { RedisClient } from './inject-redis.decorator.js';
import { REDIS_CLIENT } from './redis.constants.js';

const SCAN_DEFAULT_LIMIT = 100;
const SCAN_DEFAULT_COUNT = 100;

// Atomic read-check-delete: the key is removed only when it holds exactly
// the expected value, in a single Lua execution. Running GET and DEL as
// separate commands would leave a window where the key could change (or be
// recreated) between the check and the deletion.
const DELETE_IF_EQUALS_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('UNLINK', KEYS[1])
  return 1
end
return 0
`;

// Atomic verify-and-count-attempts: compares OTP, consumes on match, or
// increments attempt counter and invalidates OTP when max attempts reached.
// KEYS[1] = OTP key, KEYS[2] = attempts key
// ARGV[1] = submitted OTP, ARGV[2] = max attempts, ARGV[3] = TTL seconds
// Returns: 1 = verified and consumed, 0 = failed (incremented attempts or OTP invalidated)
const VERIFY_OTP_ATTEMPTS_SCRIPT = `
local otpKey = KEYS[1]
local attemptsKey = KEYS[2]
local submittedOtp = ARGV[1]
local maxAttempts = tonumber(ARGV[2])
local ttlSeconds = tonumber(ARGV[3])

local storedOtp = redis.call('GET', otpKey)
if storedOtp == submittedOtp then
  redis.call('UNLINK', otpKey)
  redis.call('UNLINK', attemptsKey)
  return 1
end

-- OTP missing, expired, or incorrect: increment attempts
local attempts = redis.call('INCR', attemptsKey)
local attemptsTtl = redis.call('TTL', attemptsKey)
if attemptsTtl <= 0 then
  redis.call('EXPIRE', attemptsKey, ttlSeconds)
end

-- If max attempts reached, invalidate the OTP so no further attempts can succeed
if attempts >= maxAttempts then
  redis.call('UNLINK', otpKey)
end

return 0
`;

// Atomic OTP send rate limit check and increment for rolling 60-minute window.
// KEYS[1] = rate limit key (sorted set)
// ARGV[1] = current timestamp in milliseconds
// ARGV[2] = window size in milliseconds (3600000 = 60 minutes)
// ARGV[3] = max allowed sends in window (5)
// ARGV[4] = key TTL in seconds (3600 = 60 minutes)
// Returns: 1 = allowed (incremented), 0 = rate limit exceeded
const CHECK_OTP_RATE_LIMIT_SCRIPT = `
local rateLimitKey = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local maxSends = tonumber(ARGV[3])
local keyTtlSeconds = tonumber(ARGV[4])

local windowStart = now - windowMs

-- Remove expired entries (older than window)
redis.call('ZREMRANGEBYSCORE', rateLimitKey, '-inf', windowStart)

-- Count current entries in window
local currentCount = redis.call('ZCARD', rateLimitKey)

if currentCount >= maxSends then
  return 0
end

-- Add new entry with current timestamp as score, unique member
local member = now .. ':' .. math.random(1000000)
redis.call('ZADD', rateLimitKey, now, member)

-- Set/refresh TTL on the key
redis.call('EXPIRE', rateLimitKey, keyTtlSeconds)

return 1
`;

export interface SetOptions {
  readonly ttlSeconds?: number;
}

export interface ScanKeysOptions {
  /** Maximum number of keys returned; iteration stops once reached. */
  readonly limit?: number;
  /** SCAN COUNT hint per iteration. */
  readonly count?: number;
}

/**
 * Application-level interface for Redis operations. Owns the connection
 * lifecycle of the shared ioredis client: it initiates the connection
 * without blocking startup, logs state transitions, and closes the
 * connection gracefully on shutdown.
 *
 * Redis connection settings are mandatory, but the Redis server itself may
 * be unreachable: while it is down, operations fail predictably (bounded
 * timeouts, no offline queue) and the health check reports degradation
 * instead of a dead process.
 *
 * Deliberately not a one-to-one ioredis wrapper: methods exist for what the
 * application needs, not for every Redis command. Direct client access is
 * an escape hatch via {@link InjectRedis}.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  private readonly shutdownTimeoutMs: number;
  private lastErrorMessage: string | undefined;
  private hasBeenReady = false;
  private shutdownComplete = false;

  constructor(
    @Inject(REDIS_CLIENT) private readonly client: RedisClient,
    configService: ConfigService,
  ) {
    this.shutdownTimeoutMs = configService.getOrThrow<RedisConfig>(REDIS_CONFIG).shutdownTimeoutMs;
  }

  /** Returns the value stored at `key`, or null when the key does not exist. */
  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  /** Stores `value` at `key`, optionally expiring it after `ttlSeconds`. */
  async set(key: string, value: string, options?: SetOptions): Promise<void> {
    if (options?.ttlSeconds !== undefined) {
      await this.client.set(key, value, 'EX', options.ttlSeconds);
      return;
    }
    await this.client.set(key, value);
  }

  /**
   * Atomically stores `value` at `key` with a TTL only if the key does not
   * already exist (Redis `SET NX EX`). Returns `true` if the key was set,
   * `false` if the key already existed (and its TTL was left untouched).
   *
   * This prevents race conditions where concurrent requests could overwrite
   * an existing OTP or extend its expiration.
   */
  async setNxEx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  /**
   * Removes keys asynchronously (`UNLINK`, not `DEL`) so deletion of large
   * keys never blocks the Redis server. Returns the number of keys removed.
   */
  async delete(...keys: string[]): Promise<number> {
    return this.client.unlink(...keys);
  }

  /** Whether `key` exists. */
  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(key)) === 1;
  }

  /** Sets an expiration on `key`; returns false when the key does not exist. */
  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    return (await this.client.expire(key, ttlSeconds)) === 1;
  }

  /** Remaining time to live of `key` in seconds (-1: no expiry, -2: missing key). */
  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  /** Atomically increments the integer at `key` by `by` (default 1). */
  async increment(key: string, by = 1): Promise<number> {
    return this.client.incrby(key, by);
  }

  /** Atomically decrements the integer at `key` by `by` (default 1). */
  async decrement(key: string, by = 1): Promise<number> {
    return this.client.incrby(key, -by);
  }

  /**
   * Iterates keys matching a glob-style `pattern` with SCAN (never KEYS,
   * which blocks the server) and returns at most `limit` keys per call.
   */
  async scanKeys(pattern: string, options?: ScanKeysOptions): Promise<string[]> {
    const limit = options?.limit ?? SCAN_DEFAULT_LIMIT;
    const count = options?.count ?? SCAN_DEFAULT_COUNT;

    const keys: string[] = [];
    let cursor = '0';
    do {
      const result = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', count);
      cursor = result[0];
      keys.push(...result[1]);
    } while (cursor !== '0' && keys.length < limit);

    return keys.slice(0, limit);
  }

  /**
   * Atomically removes `key` when it holds exactly `value`, as a single Lua
   * execution (read, compare, and `UNLINK` together). Returns whether the
   * key existed with the expected value and was consumed. A missing key or a
   * different value leaves Redis untouched and simply returns false.
   */
  async deleteIfEquals(key: string, value: string): Promise<boolean> {
    const result: unknown = await this.client.eval(DELETE_IF_EQUALS_SCRIPT, 1, key, value);
    // Redis answers Lua integer returns with a number; stringNumbers clients
    // would see '1', so both are accepted without asserting the reply type.
    return result === 1 || result === '1';
  }

  /**
   * Atomically verifies an OTP and tracks failed attempts, as a single Lua
   * execution. On a correct OTP the OTP key and attempts key are both removed
   * and `true` is returned. On a missing/incorrect OTP the attempts counter is
   * incremented (with the OTP's TTL applied on first failure); when the counter
   * reaches `maxAttempts` the OTP is invalidated so no further attempts can
   * succeed. Returns `false` for every failure — callers cannot distinguish
   * missing, expired, incorrect, or invalidated OTPs.
   */
  async verifyOtpAndCountAttempts(
    otpKey: string,
    attemptsKey: string,
    submittedOtp: string,
    maxAttempts: number,
    ttlSeconds: number,
  ): Promise<boolean> {
    const result: unknown = await this.client.eval(
      VERIFY_OTP_ATTEMPTS_SCRIPT,
      2,
      otpKey,
      attemptsKey,
      submittedOtp,
      maxAttempts,
      ttlSeconds,
    );
    return result === 1 || result === '1';
  }

  /**
   * Atomically checks and increments the per-phone OTP send rate limit for a
   * rolling 60-minute window, as a single Lua execution.
   * Returns `true` if the send is allowed (under the limit), `false` if the
   * rate limit is exceeded.
   *
   * Uses a sorted set with timestamps as scores to track sends within the
   * window. Expired entries are removed before counting.
   */
  async checkOtpRateLimit(
    rateLimitKey: string,
    maxSends: number = 5,
    windowMinutes: number = 60,
  ): Promise<boolean> {
    const now = Date.now();
    const windowMs = windowMinutes * 60 * 1000;
    const keyTtlSeconds = windowMinutes * 60;

    const result: unknown = await this.client.eval(
      CHECK_OTP_RATE_LIMIT_SCRIPT,
      1,
      rateLimitKey,
      now,
      windowMs,
      maxSends,
      keyTtlSeconds,
    );
    return result === 1 || result === '1';
  }

  /**
   * Connectivity probe used by the health indicator. Bounded by the client's
   * `commandTimeout`; fails fast while the client is not connected because
   * the offline queue is disabled.
   */
  async ping(): Promise<void> {
    await this.client.ping();
  }

  onModuleInit(): void {
    this.attachEventListeners(this.client);
    // Initiated, not awaited: startup never blocks on Redis. With an always
    // retrying strategy connect() stays pending instead of rejecting; the
    // catch is purely defensive and failures surface through the listeners.
    void this.client.connect().catch((error: Error) => {
      this.logger.warn({ err: error }, 'Redis initial connection attempt failed.');
    });
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.shutdownComplete) {
      return;
    }
    this.shutdownComplete = true;

    const client = this.client;
    // Listeners were registered once in onModuleInit; remove them before
    // tearing the client down so shutdown-time events stay silent and no
    // references are retained.
    client.removeAllListeners();

    if (client.status === 'end') {
      return;
    }

    if (client.status !== 'ready') {
      // Waiting, connecting, or reconnecting: no live session to quit
      // gracefully, so release the client immediately.
      client.disconnect();
      return;
    }

    const quit = client.quit().catch(() => {
      client.disconnect();
    });
    await Promise.race([
      quit,
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, this.shutdownTimeoutMs);
        timer.unref();
      }),
    ]);

    // Either QUIT completed (status is now 'end') or the timeout won and the
    // connection must be force-closed to keep shutdown bounded. isEnded is a
    // method call so the status is re-read instead of using the type-narrowed
    // value from the ready check above.
    if (this.isEnded(client)) {
      return;
    }
    client.disconnect();
  }

  private isEnded(client: Redis): boolean {
    return client.status === 'end';
  }

  private attachEventListeners(client: Redis): void {
    client.on('connect', () => this.logger.debug('Redis connecting.'));

    client.on('ready', () => {
      const recovered = this.hasBeenReady;
      this.hasBeenReady = true;
      // Reset so a recurring error after recovery is logged again.
      this.lastErrorMessage = undefined;
      if (recovered) {
        this.logger.log('Redis connection recovered.');
      } else {
        this.logger.log('Redis connection ready.');
      }
    });

    // ioredis emits 'error' on every failed attempt while reconnecting; only
    // a new, distinct error message is logged to avoid flooding the logs.
    client.on('error', (error: Error) => {
      if (error.message === this.lastErrorMessage) {
        return;
      }
      this.lastErrorMessage = error.message;
      this.logger.warn({ err: error }, 'Redis connection error.');
    });

    client.on('close', () => this.logger.debug('Redis connection closed.'));
    client.on('reconnecting', (delay: number) =>
      this.logger.debug({ delay }, 'Redis reconnecting.'),
    );
    client.on('end', () => this.logger.warn('Redis connection ended.'));
  }
}
