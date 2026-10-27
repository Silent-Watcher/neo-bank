import { fileURLToPath } from 'node:url';

// Keeps Vitest resolving #... aliases to source files instead of the
// "default" condition in package.json imports, which points at dist/.
// Shared by the unit-test and e2e Vitest configs.
export const subpathImportAliases = [
  { find: '#src/', replacement: fileURLToPath(new URL('../src/', import.meta.url)) },
  {
    find: '#config/',
    replacement: fileURLToPath(new URL('../src/shared/config/', import.meta.url)),
  },
  { find: '#enums/', replacement: fileURLToPath(new URL('../src/shared/enums/', import.meta.url)) },
  {
    find: '#errors/',
    replacement: fileURLToPath(new URL('../src/shared/errors/', import.meta.url)),
  },
  { find: '#http/', replacement: fileURLToPath(new URL('../src/shared/http/', import.meta.url)) },
];
