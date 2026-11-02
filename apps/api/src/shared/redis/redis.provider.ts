import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

import { REDIS_CONFIG } from '#config/redis.config.js';
import type { RedisConfig } from '#config/redis.config.js';

import { REDIS_CLIENT } from './redis.constants.js';
import { buildRedisOptions } from './redis-options.js';

// Builds the single shared client. Construction with lazyConnect never dials
// the server, so an unreachable Redis cannot block application startup; the
// connection is initiated (without awaiting) by RedisService's lifecycle.
export function createRedisClient(config: RedisConfig): Redis {
  return new Redis(config.url, buildRedisOptions(config));
}

export const redisClientProvider: Provider = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): Redis =>
    createRedisClient(configService.getOrThrow<RedisConfig>(REDIS_CONFIG)),
};
