import { Inject } from '@nestjs/common';

import { REDIS_CLIENT } from './redis.constants.js';

/**
 * Injects the shared ioredis client directly.
 *
 * This is an explicit escape hatch for exceptional cases that genuinely
 * require a native ioredis capability the {@link RedisService} does not
 * cover. Ordinary application code must use `RedisService` instead.
 */
export function InjectRedis(): ParameterDecorator {
  return Inject(REDIS_CLIENT);
}

/** The injected client type: the single shared ioredis instance. */
export type RedisClient = import('ioredis').Redis;
