import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';

import { _env } from './env/env.config.js';

export const ENROLLMENTS_CONFIG = Symbol('ENROLLMENTS_CONFIG');

const enrollmentsConfig = registerAs(ENROLLMENTS_CONFIG, () => ({
  maxVerifyAttempts: _env.ENROLLMENTS_MAX_VERIFY_ATTEMPTS,
  lockoutTtlSeconds: _env.ENROLLMENTS_LOCKOUT_TTL_SECONDS,
}));

export default enrollmentsConfig;

export type EnrollmentsConfig = ConfigType<typeof enrollmentsConfig>;
