import { ConfigModule } from '@nestjs/config';

import logConfig from './log.config.js';
import rateLimitConfig from './rate-limit.config.js';
import redisConfig from './redis.config.js';
import serverConfig from './server.config.js';

export const configModule = ConfigModule.forRoot({
  isGlobal: true,
  ignoreEnvFile: true,
  load: [serverConfig, logConfig, redisConfig, rateLimitConfig],
});
