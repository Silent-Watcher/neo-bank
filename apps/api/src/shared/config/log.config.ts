import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';

import { AppEnv } from '#enums/app-env.enum.js';
import { _env } from './env/env.config.js';

export const LOG_CONFIG = Symbol('LOG_CONFIG');

const logConfig = registerAs(LOG_CONFIG, () => ({
  level: _env.LOG_LEVEL,
  // Pretty printing is a local development convenience; every other
  // environment emits structured JSON.
  pretty: _env.APP_ENV === AppEnv.Development,
}));

export default logConfig;

export type LogConfig = ConfigType<typeof logConfig>;
