import { defineConfig } from 'vitest/config';
import { subpathImportAliases } from './subpath-import-aliases.js';

// Real-Redis rate-limit tests: run with `pnpm test:redis`, which loads
// env/.env.redis-test. Each test file starts its own Testcontainers Redis
// container; files run sequentially so their containers never overlap.
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
