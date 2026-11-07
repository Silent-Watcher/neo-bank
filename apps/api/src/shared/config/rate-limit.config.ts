import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';

import { _env } from './env/env.config.js';

export const RATE_LIMIT_CONFIG = Symbol('RATE_LIMIT_CONFIG');

// Limits are request counts; TTL values are seconds/minutes and are converted
// to milliseconds (the @nestjs/throttler unit) by the throttler module factory.
const rateLimitConfig = registerAs(RATE_LIMIT_CONFIG, () => ({
  shortLimit: _env.RATE_LIMIT_SHORT_LIMIT,
  shortTtlSeconds: _env.RATE_LIMIT_SHORT_TTL_SECONDS,
  longLimit: _env.RATE_LIMIT_LONG_LIMIT,
  longTtlMinutes: _env.RATE_LIMIT_LONG_TTL_MINUTES,
}));

export default rateLimitConfig;

export type RateLimitConfig = ConfigType<typeof rateLimitConfig>;
