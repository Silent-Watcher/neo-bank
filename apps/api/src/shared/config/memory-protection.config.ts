import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';

import { _env } from './env/env.config.js';

export const MEMORY_PROTECTION_CONFIG = Symbol('MEMORY_PROTECTION_CONFIG');

const memoryProtectionConfig = registerAs(MEMORY_PROTECTION_CONFIG, () => ({
  enabled: _env.MEMORY_PROTECTION_ENABLED,
  maxRssMb: _env.MEMORY_PROTECTION_MAX_RSS_MB,
  recoveryRssMb: _env.MEMORY_PROTECTION_RECOVERY_RSS_MB,
  sampleIntervalMs: _env.MEMORY_PROTECTION_SAMPLE_INTERVAL_MS,
  stableSamples: _env.MEMORY_PROTECTION_STABLE_SAMPLES,
}));

export default memoryProtectionConfig;

export type MemoryProtectionConfig = ConfigType<typeof memoryProtectionConfig>;
