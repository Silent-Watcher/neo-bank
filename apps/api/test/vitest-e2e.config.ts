import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';
import { subpathImportAliases } from './subpath-import-aliases.js';

export default defineConfig({
  resolve: {
    alias: subpathImportAliases,
  },
  test: {
    include: ['**/*.e2e-spec.ts'],
    environment: 'node',
    // Files run sequentially: they share ONE Testcontainers Redis (ADR-025),
    // and the rate-limit and idempotency scenarios assert exact Redis key
    // state — parallel files cleaning or writing shared key namespaces would
    // race those assertions. (The test:redis tier makes the same trade-off;
    // it runs one container per file instead.)
    fileParallelism: false,
    // One shared Testcontainers Redis per test execution (ADR-025); its
    // connection config reaches the specs through provide/inject.
    globalSetup: fileURLToPath(new URL('./e2e.global-setup.ts', import.meta.url)),
  },
});
