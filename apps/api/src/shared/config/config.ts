import { ConfigModule } from '@nestjs/config';

import databaseConfig from './database.config.js';
import enrollmentsConfig from './enrollments.config.js';
import logConfig from './log.config.js';
import memoryProtectionConfig from './memory-protection.config.js';
import rateLimitConfig from './rate-limit.config.js';
import redisConfig from './redis.config.js';
import serverConfig from './server.config.js';

export const configModule = ConfigModule.forRoot({
  isGlobal: true,
  ignoreEnvFile: true,
  load: [
    serverConfig,
    logConfig,
    databaseConfig,
    redisConfig,
    rateLimitConfig,
    enrollmentsConfig,
    memoryProtectionConfig,
  ],
});
