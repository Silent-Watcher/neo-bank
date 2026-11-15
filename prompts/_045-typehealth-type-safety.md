# _045 — TypeHealth Type-Safety Audit and Fixes

## Original Request

"Use the typehealth tool to improve TypeScript type safety of the project."
The user installed `typehealth@^0.10.0` as a root devDependency and provided
the `typehealth` skill (scan workflow: analyze before modifying, findings are
signals not instructions, never game the metrics, validate every change).

## Implementation Record

- Baseline scans per workspace (the repo root has no `tsconfig.json` — three
  solution configs, one per workspace):
  - **api** (137 files): 99.4% coverage, 41 findings — 9 in production `src/`
    (8 implicit-any + 1 heuristic JSON.parse boundary), 30 in spec/e2e files,
    1 low (spec `!`), 1 info. `weakStrictnessFlags: 0`.
  - **web** (5 files): 75.6% reported — every finding is inside
    `.next/types/validator.ts` / `.next/dev/types/validator.ts` (Next.js
    generated codegen); the real source (`layout.tsx`, `page.tsx`,
    `next.config.ts`) is 100% clean.
  - **admin** (root `tsconfig.json`): false-positive report — the
    solution-style `files: []` config analyzed 0 files and reported 9
    disabled strictness flags; the real configs (`tsconfig.app.json`,
    `tsconfig.node.json`) already have `"strict": true`.
- Production fixes (type annotations only, runtime-identical):
  - `apps/api/src/shared/filters/problem-details.filter.ts` — message-array
    filter predicate annotated `(item: unknown): item is string`
    (`Array.isArray` on `unknown` narrows to `any[]`).
  - `apps/api/src/shared/interceptors/response-envelope.interceptor.ts` —
    header loop fed through an explicit `const headerList: unknown[]` binding;
    rxjs `map` callback annotated `(data: unknown)`.
  - `apps/api/src/shared/logging/pino-http.options.ts` — callback parameters
    annotated to the declared pino-http signature (`IncomingMessage`,
    `ServerResponse`, `object` / `Error`), keeping `req.id` typed through
    module augmentation.
  - `apps/admin/src/main.tsx` — `document.getElementById('root')!` replaced
    with a guard clause that throws (a DOM lookup is a trust boundary).
- Investigated and intentionally not changed:
  - `apps/api/src/shared/swagger/openapi.schemas.ts:26` — the
    `JSON.parse(JSON.stringify(z.toJSONSchema(...)))` round-trip parses
    internally generated JSON (cannot fail); any typed alternative needs an
    unsafe assertion (`as SchemaObject`) or changes the deliberate
    drop-undefined semantics (`structuredClone`). The tool labels the
    finding heuristic/uncertain.
  - 30 test-file findings — the `as unknown as` double assertions are the
    repository's established Vitest mock idiom and the `JSON.parse` uses are
    test fixtures; rewriting them is churn without a safety gain.
  - web `.next` findings — Next.js-generated files are not project source;
    excluding them from the tsconfig would affect Next's own route type
    checking.
- Validation: root `pnpm format:check` exit 0 (oxfmt rewrapped the annotated
  pino-http callback), `pnpm typecheck` exit 0 across all three workspaces,
  api unit tier 341/341 passed, admin lint 0 warnings / 0 errors.
- Result: api 99.4% → **99.7%** coverage, findings 41 → 33 with **zero in
  production `src/`**; admin (scanned with `tsconfig.app.json`) **100%
  coverage, 0 medium, 0 low**; web real source unchanged and clean.

## Constraints honored

- No dependencies added (typehealth was installed by the user); no suppressions,
  no `as any`, no tsconfig weakening; semantics preserved (annotation-only
  changes verified by the full unit tier and typecheck); no commit created.
