import { defineConfig } from 'vitest/config';
import { subpathImportAliases } from './test/subpath-import-aliases.js';

export default defineConfig({
  resolve: {
    alias: subpathImportAliases,
  },
});
