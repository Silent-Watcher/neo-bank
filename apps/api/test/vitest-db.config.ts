import { defineConfig } from 'vitest/config';
import { subpathImportAliases } from './subpath-import-aliases.js';

// Database integration tests (ADR-027): run with `pnpm test:db`, which loads
// env/.env.db-test. Each test file boots the real AppModule against its own
// Testcontainers PostgreSQL container; files run sequentially so their
// containers never overlap.
export default defineConfig({
  resolve: {
    alias: subpathImportAliases,
  },
  test: {
    include: ['**/*.db-spec.ts'],
    environment: 'node',
    fileParallelism: false,
  },
});
