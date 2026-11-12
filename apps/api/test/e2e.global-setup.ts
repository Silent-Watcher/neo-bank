import type { TestProject } from 'vitest/node';

import type { RedisConfig } from '#config/redis.config.js';
import { startTestRedis } from './testcontainers.js';

// Vitest global setup for the e2e suite (vitest-e2e.config.ts). Starts ONE
// shared Testcontainers Redis for the whole test execution (ADR-025) and
// provides its connection config to every worker through Vitest's native
// provide/inject channel — no env mutation, no fixed ports.
//
// The returned function is the teardown: Vitest awaits it after the run,
// including failing runs. A crashed process is covered by Testcontainers'
// default resource reaper (ryuk), which removes the orphaned container.

declare module 'vitest' {
  interface ProvidedContext {
    e2eRedisConfig: RedisConfig;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const { redis, config } = await startTestRedis();
  project.provide('e2eRedisConfig', config);

  return async () => {
    await redis.stop();
  };
}
