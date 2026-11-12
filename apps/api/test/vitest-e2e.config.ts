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
    // One shared Testcontainers Redis per test execution (ADR-025); its
    // connection config reaches the specs through provide/inject.
    globalSetup: fileURLToPath(new URL('./e2e.global-setup.ts', import.meta.url)),
  },
});
