import { Module } from '@nestjs/common';
import { IdempotencyModule } from '@nestjs/idempotency';

import { RedisModule } from '#redis/redis.module.js';
import { RedisIdempotencyStore } from './redis-idempotency.store.js';

/**
 * Application idempotency integration (ADR-039). Imports the official
 * IdempotencyModule (registers the one global IdempotencyInterceptor with the
 * default `Idempotency-Key` header and the default 10 s store timeout) and
 * provides the Redis-backed store as the single registered IdempotencyStore.
 *
 * The store registers itself with IdempotencyStorage in its constructor:
 * Nest instantiates every provider before any onModuleInit hook runs, so the
 * source is in place before the package locks its store registry. The
 * package logs the selected store at startup ("IdempotencyStorage: ..."),
 * which is the supported verification that no in-memory store is active.
 */
const idempotencyModule = IdempotencyModule.forRoot({});

@Module({
  imports: [idempotencyModule, RedisModule],
  providers: [RedisIdempotencyStore],
})
export class IdempotencyStoreModule {}
