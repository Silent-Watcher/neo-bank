import { ConfigService } from '@nestjs/config';
import { minutes, seconds, ThrottlerModule } from '@nestjs/throttler';

import type { RateLimitConfig } from '#config/rate-limit.config.js';
import { RATE_LIMIT_CONFIG } from '#config/rate-limit.config.js';
import { RedisModule } from '#redis/redis.module.js';
import type { RedisClient } from '#redis/redis.module.js';
import { REDIS_CLIENT } from '#redis/redis.constants.js';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

/**
 * Global HTTP rate limiting (ADR-015): the official @nestjs/throttler module
 * with two named policies (`short`, `long`) backed by the application's
 * single shared Redis connection through {@link RedisThrottlerStorage}.
 *
 * The Redis connection is received via the existing REDIS_CLIENT provider —
 * the storage never opens or closes a connection; the lifecycle stays with
 * the RedisModule. TTLs arrive from configuration in seconds/minutes and are
 * converted to the milliseconds unit the throttler expects with the official
 * `seconds()`/`minutes()` helpers.
 */
export const throttlerModule = ThrottlerModule.forRootAsync({
  imports: [RedisModule],
  inject: [REDIS_CLIENT, ConfigService],
  useFactory: (client: RedisClient, configService: ConfigService) => {
    const config = configService.getOrThrow<RateLimitConfig>(RATE_LIMIT_CONFIG);
    return {
      throttlers: [
        { name: 'short', limit: config.shortLimit, ttl: seconds(config.shortTtlSeconds) },
        { name: 'long', limit: config.longLimit, ttl: minutes(config.longTtlMinutes) },
      ],
      storage: new RedisThrottlerStorage(client),
    };
  },
});
