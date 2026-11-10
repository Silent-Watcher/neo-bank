import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';

import { _env } from './env/env.config.js';

export const SERVER_CONFIG = Symbol('SERVER_CONFIG');

const serverConfig = registerAs(SERVER_CONFIG, () => ({
  env: _env.APP_ENV,
  host: _env.HOST,
  port: _env.PORT,
  corsOrigins: _env.CORS_ORIGIN,
  trustProxy: _env.TRUST_PROXY,
  bodyLimit: _env.BODY_LIMIT,
  redisInsightUrl: _env.REDIS_INSIGHT_URL,
}));

export default serverConfig;

export type ServerConfig = ConfigType<typeof serverConfig>;
