import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';

import { _env } from './env/env.config.js';

export const IDEMPOTENCY_CONFIG = Symbol('IDEMPOTENCY_CONFIG');

const idempotencyConfig = registerAs(IDEMPOTENCY_CONFIG, () => ({
  scopeSecret: _env.IDEMPOTENCY_SCOPE_SECRET,
}));

export default idempotencyConfig;

export type IdempotencyConfig = ConfigType<typeof idempotencyConfig>;
