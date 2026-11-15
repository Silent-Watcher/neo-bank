# _049 — GitNexus Code Intelligence: Developer Documentation and Navigation Rule

## Request

> "can you use gitnexus right now for better understanding the project using the graphs or should i do anything else. quick check for me"

Follow-up:

> "ok document what you can do with it inside onboarding for developers and also for a rule add the fact that whenever you need to find something quickly or understand the project (with project explorer sub agent or etc) use this tool to help you quickly reach at your destination"

## Verification performed

- Confirmed the GitNexus index exists at `.gitnexus/`, indexed 2026-11-15 at commit `b301822` (then-HEAD of `feature/enrollments`), so it was fresh — no re-index needed.
- The first CLI call bootstrapped gitnexus 1.6.12 through `pnpm dlx` (one-time download, now cached); subsequent calls run in under a second.
- Ran a probe `impact "BaseEntity" --direction upstream` — resolved the symbol from `apps/api/src/shared/database/base.entity.ts` but reported `risk: UNKNOWN` with 0 resolved callers (inheritance edges are not graph-resolvable), confirming the documented caveat that empty caller sets require text-search confirmation.
- Verified all subcommands documented in the README exist: `status`, `analyze`, `query`, `context`, `impact`, `detect-changes`.

## Changes

1. **`README.md`** — new "Code Intelligence (GitNexus)" section for developers: what the tool is, the command table (`status` / `analyze --index-only` / `query` / `context` / `impact` / `detect-changes`, all through `node .gitnexus/run.cjs --repo .`), index-freshness guidance, the `risk: UNKNOWN` caveat, and pointers to the `gitnexus-*` skills.
2. **`AGENTS.md`** — new "Code Intelligence (GitNexus)" subsection under "Documentation and Context Management": the behavioral rule that graph queries (`query`/`context`/`impact`) are the first stop for any navigation or comprehension question before broad text search; that this complements `project-explorer` (docs baseline) at session start; the CLI fallback when MCP tools are unavailable; and the unresolved-risk caveat. The pre-existing injected GitNexus block (mandatory pre-edit/pre-commit rules) is referenced, not duplicated.
3. `CLAUDE.md` required no change — it imports `AGENTS.md` via `@AGENTS.md`.

## Decisions

- Documented in `README.md` (the developer onboarding entry point) rather than creating a new root `ONBOARDING.md` or per-app docs, since GitNexus is repo-wide tooling, not tied to a workspace.
- Added the navigation rule to `AGENTS.md` (not `CLAUDE.md` directly) to keep a single source of truth; the rule sits with the existing context-loading policy it complements.

## Validation

- Documentation-only change; no source code touched, so lint/test/format runs were not applicable per the project rule for non-source changes.
- All documented CLI subcommands verified to exist by direct invocation.
