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
