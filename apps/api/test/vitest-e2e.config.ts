import { defineConfig } from 'vitest/config';
import { subpathImportAliases } from './subpath-import-aliases.js';

export default defineConfig({
  resolve: {
    alias: subpathImportAliases,
  },
  test: {
    include: ['**/*.e2e-spec.ts'],
    environment: 'node',
  },
});
