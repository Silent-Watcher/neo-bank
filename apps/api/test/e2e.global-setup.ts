import type { TestProject } from 'vitest/node';

import type { RedisConfig } from '#config/redis.config.js';
import { startTestPostgres, startTestRedis } from './testcontainers.js';

// Vitest global setup for the e2e suite (vitest-e2e.config.ts). Starts ONE
// shared Testcontainers Redis (ADR-025) and ONE shared Testcontainers
// PostgreSQL (ADR-027) for the whole test execution and provides their
// connection config to every worker through Vitest's native provide/inject
// channel — no env mutation, no fixed ports.
//
// The returned function is the teardown: Vitest awaits it after the run,
// including failing runs. A crashed process is covered by Testcontainers'
// default resource reaper (ryuk), which removes the orphaned containers.

declare module 'vitest' {
  interface ProvidedContext {
    e2eRedisConfig: RedisConfig;
    e2ePostgresUrl: string;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const { redis, config } = await startTestRedis();
  project.provide('e2eRedisConfig', config);
  const { postgres, url } = await startTestPostgres();
  project.provide('e2ePostgresUrl', url);

  return async () => {
    await redis.stop();
    await postgres.stop();
  };
}
