import { defineConfig } from 'vitest/config';
import { subpathImportAliases } from './test/subpath-import-aliases.js';

export default defineConfig({
  resolve: {
    alias: subpathImportAliases,
  },
  test: {
    // Unit-tier coverage (ADR-035), enabled only through `pnpm test:coverage`
    // (`--coverage`); the plain unit run pays no collection overhead. Setting
    // `include` is what counts files no test imports (Vitest 5 has no
    // `coverage.all`); generated migrations and the specs themselves stay
    // out of the report.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**'],
      exclude: ['src/**/*.spec.ts', 'src/**/migrations/**'],
    },
  },
});
