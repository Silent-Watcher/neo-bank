import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';

import { _env } from './env/env.config.js';

export const SERVER_CONFIG = Symbol('SERVER_CONFIG');

const serverConfig = registerAs(SERVER_CONFIG, () => ({
  env: _env.APP_ENV,
  host: _env.HOST,
  port: _env.PORT,
}));

export default serverConfig;

export type ServerConfig = ConfigType<typeof serverConfig>;
