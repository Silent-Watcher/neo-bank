# _042 — `#database` Subpath Import Alias

## Original Request

The user requested introducing a `#database/*` subpath import alias for `src/shared/database/*`, following the project's existing alias conventions exactly, replacing all applicable imports, and verifying across TypeScript, development, tests, and the compiled Node.js runtime. Look-first workflow with an approval gate before changes.

## Implementation Record

- **Phase 1 (report + approval):** existing alias machinery documented — `package.json` `imports` map (`types` → src, `default` → dist) resolves natively under NodeNext (no tsconfig `paths`), SWC is alias-blind, Vitest resolves via `test/subpath-import-aliases.ts`. 8 import statements in 5 files referenced `#src/shared/database/…`. Plan approved via AskUserQuestion.
- **Phase 2:** `"#database/*": { "types": "./src/shared/database/*", "default": "./dist/shared/database/*" }` added to `apps/api/package.json`; `#database/` entry added to `test/subpath-import-aliases.ts`. No barrel file, no exact root mapping (no entry point exists), no tsconfig/build changes.
- **Phase 3:** 8 imports replaced across `app.module.ts`, `health.controller.ts`, `health.controller.spec.ts`, `test/create-test-app.ts` (2), `test/database.db-spec.ts` (3). Sibling imports inside `src/shared/database/` and the CLI config's relative siblings deliberately untouched (a `#database` import inside the swc-loaded CLI config would resolve that sibling to possibly-stale `dist/`).
- **Phase 4 (verification, all executed):** `pnpm typecheck` clean; `pnpm build` clean (71 files); unit 340→341 (grew in the parallel _041 task), `test:db` 4/4, `test:redis` 60/60, `test:e2e` 83/83; `mikro-orm debug` connection successful; production-condition boot (`node dist/main.js`, `default` → dist resolution) — `PostgreSQL connection established`, `/health` `postgres: up`, SIGTERM clean; repo-wide grep: no `#src/shared/database` and no cross-directory relative imports into `src/shared/database` remain in executable source.
- **Constraints honored:** minimal change, no file moves, no new resolution library, no commits.
