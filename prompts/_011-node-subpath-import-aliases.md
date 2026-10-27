# Node.js Subpath Import Aliases

## User Request

Implement Node.js native subpath import aliases (`imports` field in `package.json`) to replace deeply nested parent-relative imports with `#...` aliases. Update application and test imports, add "Import aliases" and "Type safety from the start" rules to `AGENTS.md`, and enforce the import rule with Oxlint's `import/no-relative-parent-imports` where supported.

## Implementation

- Added an `imports` field to `apps/api/package.json` with conditional mappings: `types` points at the `src/` TypeScript files, `default` points at the compiled `dist/` output (verified: `nest build` with the swc builder mirrors `src/` 1:1 into `dist/`, including `dist/shared/...`).
- Aliases defined: `#src/*` (whole `src/`), `#config/*` (`src/shared/config`), `#enums/*` (`src/shared/enums`), `#errors/*` (`src/shared/errors`), `#http/*` (`src/shared/http`). No new dependencies were added; TypeScript with `NodeNext` resolution resolves `#` aliases natively from `package.json`, so no `tsconfig` `paths` changes were required.
- Rewrote all parent-relative (`../`, `../../`, `../../../`) imports in `src/` and `test/` to the corresponding `#...` aliases. Same-directory `./` imports were left untouched.
- Added `apps/api/test/subpath-import-aliases.ts` exporting `subpathImportAliases`, consumed by the new root `vitest.config.ts` (unit tests) and by `test/vitest-e2e.config.ts`. This keeps Vitest resolving the aliases to source files instead of the `default` condition's `dist/` output, and avoids parent-relative imports between the two configs so the new lint rule passes.
- Enabled `import/no-relative-parent-imports` as an error in `apps/api/.oxlintrc.json` (Oxlint 1.89.0 supports the built-in rule; activated the built-in `import` plugin).
- Added an "Imports and Type Safety" section to the root `AGENTS.md` with the two requested rules.

## Validation

- `pnpm run format:check` (oxfmt): pass.
- `pnpm run lint` (oxlint): 0 errors; 11 warnings, all pre-existing (`no-conditional-expect`, `require-mock-type-parameters`, `no-unsafe-optional-chaining` in existing spec files).
- `pnpm run typecheck` (tsc --noEmit): pass.
- `pnpm run build` (nest build): pass, 24 files compiled; compiled output keeps the `#...` specifiers.
- Runtime resolution: `node --env-file=env/.env.development -e "import('./dist/app.module.js')"` completes (module graph fully loads through the `default` condition mappings).
- `pnpm run test` (unit, vitest): 96/96 pass across 13 files.
- `pnpm run test:e2e`: 6 failures in `envelope.e2e-spec.ts` and `logging.e2e-spec.ts`. These are pre-existing on `master` (verified by stashing the change and running the same suite on a clean tree: identical 2 files failed / 6 tests failed) and are unrelated to import aliasing.

## Remaining Limitations

- The 6 pre-existing e2e failures (response envelope passthrough behavior and access-log redaction/error logging) were not fixed; they are outside this task's scope.
