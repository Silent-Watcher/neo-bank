import { Global, Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';

// Unit tests must not depend on ambient environment state, so the env
// validation layer is replaced with a fully valid environment.
vi.mock('#config/env/env.config.js', () => ({
  _env: {
    REDIS_URL: 'redis://localhost:6379',
    REDIS_USERNAME: undefined,
    REDIS_PASSWORD: undefined,
    REDIS_DB: undefined,
    REDIS_TLS: false,
    REDIS_CONNECT_TIMEOUT_MS: 10000,
    REDIS_COMMAND_TIMEOUT_MS: 5000,
    REDIS_MAX_RETRIES_PER_REQUEST: 3,
    REDIS_SHUTDOWN_TIMEOUT_MS: 2000,
  },
}));

import { InjectRedis } from './inject-redis.decorator.js';
import type { RedisClient } from './inject-redis.decorator.js';
import { REDIS_CLIENT } from './redis.constants.js';
import { RedisModule } from './redis.module.js';
import { RedisService } from './redis.service.js';

// A feature module that never imports RedisModule: it relies on RedisModule
// being @Global(), exactly as unrelated application modules consume Redis.
@Injectable()
class ConsumerService {
  constructor(
    public readonly redisService: RedisService,
    @InjectRedis() public readonly rawClient: RedisClient,
  ) {}
}

@Module({
  providers: [ConsumerService],
})
class ConsumerModule {}

// Stand-in for the global ConfigModule registration so the client factory and
// RedisService resolve configuration without loading real environment files.
// @Global() mirrors the production ConfigModule, whose exports are visible
// to every module — including RedisModule's providers.
const testRedisConfig = {
  url: 'redis://127.0.0.1:1',
  username: '',
  password: '',
  db: undefined,
  tls: false,
  connectTimeoutMs: 10000,
  commandTimeoutMs: 5000,
  maxRetriesPerRequest: 3,
  shutdownTimeoutMs: 1000,
};

@Global()
@Module({
  providers: [{ provide: ConfigService, useValue: { getOrThrow: () => testRedisConfig } }],
  exports: [ConfigService],
})
class TestConfigModule {}

describe('RedisModule', () => {
  it('is available globally without importing it in consumer modules', async () => {
    // Arrange
    const module = await Test.createTestingModule({
      imports: [TestConfigModule, RedisModule, ConsumerModule],
    })
      .overrideProvider(REDIS_CLIENT)
      .useValue(new Redis({ lazyConnect: true }))
      .compile();

    // Act
    const consumer = module.get(ConsumerService);
    const client = module.get<Redis>(REDIS_CLIENT);

    // Assert
    expect(consumer.redisService).toBeInstanceOf(RedisService);
    expect(consumer.rawClient).toBe(client);
  });

  it('provides exactly one shared client and one RedisService', async () => {
    // Arrange
    const module = await Test.createTestingModule({
      imports: [TestConfigModule, RedisModule, ConsumerModule],
    }).compile();

    // Act
    const service = module.get(RedisService);
    const consumer = module.get(ConsumerService);

    // Assert
    expect(consumer.redisService).toBe(service);
    expect(consumer.rawClient).toBe(module.get(REDIS_CLIENT));
  });

  it('uses a symbol-based injection token', () => {
    // Arrange & Act & Assert
    expect(typeof REDIS_CLIENT).toBe('symbol');
  });
});
