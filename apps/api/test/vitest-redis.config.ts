import { defineConfig } from 'vitest/config';
import { subpathImportAliases } from './subpath-import-aliases.js';

// Real-Redis rate-limit tests: run with `pnpm test:redis`, which loads
// env/.env.redis-test. Files share one Redis server, so they run sequentially.
export default defineConfig({
  resolve: {
    alias: subpathImportAliases,
  },
  test: {
    include: ['**/*.redis-spec.ts'],
    environment: 'node',
    fileParallelism: false,
  },
});
