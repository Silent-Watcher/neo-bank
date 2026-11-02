import { Global, Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { InjectRedis } from './inject-redis.decorator.js';
import { REDIS_CLIENT } from './redis.constants.js';
import { redisClientProvider } from './redis.provider.js';
import { RedisHealthIndicator } from './redis.health.js';
import { RedisService } from './redis.service.js';

/**
 * Global Redis integration module. Registered exactly once (AppModule);
 * its exports are available to every feature module without importing it.
 *
 * Owns the full connection lifecycle: the client provider constructs the
 * single shared ioredis instance, RedisService initiates and closes the
 * connection through NestJS lifecycle hooks.
 *
 * TerminusModule supplies HealthIndicatorService for the Redis health
 * indicator; it is the same plain module AppModule imports, so no duplicate
 * Terminus providers are created.
 *
 * The raw client provider is exported so the InjectRedis() escape hatch
 * resolves in consumer modules; the REDIS_CLIENT token itself stays internal
 * (consumers use the decorator or RedisService, never the symbol).
 */
@Global()
@Module({
  imports: [TerminusModule],
  providers: [redisClientProvider, RedisService, RedisHealthIndicator],
  exports: [REDIS_CLIENT, RedisService, RedisHealthIndicator],
})
export class RedisModule {}

// Re-exported so consumers never import the internal REDIS_CLIENT token.
export { InjectRedis };
export type { RedisClient } from './inject-redis.decorator.js';
