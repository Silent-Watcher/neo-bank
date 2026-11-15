import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';

import { _env } from './env/env.config.js';

export const SERVER_CONFIG = Symbol('SERVER_CONFIG');

const serverConfig = registerAs(SERVER_CONFIG, () => ({
  env: _env.APP_ENV,
  host: _env.HOST,
  port: _env.PORT,
  corsOrigins: _env.CORS_ORIGIN,
  // The adapter-ready proxy-trust value: with TRUST_PROXY=true the optional
  // TRUST_PROXY_PROXIES allowlist narrows trust to the listed proxies;
  // without the list every hop is trusted (requires an XFF-sanitizing proxy).
  trustProxy: _env.TRUST_PROXY ? (_env.TRUST_PROXY_PROXIES ?? true) : false,
  bodyLimit: _env.BODY_LIMIT,
  redisInsightUrl: _env.REDIS_INSIGHT_URL,
  mockserverHostUrl: _env.MOCKSERVER_HOST_URL,
  mockserverDockerUrl: _env.MOCKSERVER_DOCKER_URL,
}));

export default serverConfig;

export type ServerConfig = ConfigType<typeof serverConfig>;
