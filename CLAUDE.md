# CLAUDE.md

Claude Code entry point for this repository. All project rules, conventions,
and the development workflow live in the root agent instructions:

@AGENTS.md

## Claude Code–specific notes

- The four project subagents (`project-explorer`, `code-reviewer`,
  `code-security-analyzer`, `documentation-writer`) are discovered natively
  from `.claude/agents/`. These files are generated from the canonical
  definitions in `.agents/definitions/` by `node scripts/agents/sync.mjs` —
  never edit the generated files; change the canonical definitions and
  re-run the sync.
- Project hooks in `.claude/settings.json` inject the session-start
  instruction (invoke `project-explorer` at session start) and enforce the
  documentation-only write policy for the `documentation-writer` subagent.
- The same workflow runs in the ZCode agent through the local
  `monorepo-workflow` plugin; see the Multi-Agent Development Workflow
  section in `AGENTS.md` and `.agents/README.md` for setup and usage.

## Database (PostgreSQL + MikroORM)

- Postgres runs in Docker via docker compose. Never point local code at a shared or production database.
- MikroORM is the only way the app talks to Postgres. No raw pg client, no other ORM.
- Schema changes go only through migrations: change the entity → `db:migration:create` → read the generated SQL → `db:migration:up`.
- Never use schema:update or synchronize. Never edit a migration that has already run; write a new one.
- Entities:
  - One entity per file, `<name>.entity.ts`, inside its feature's `entities/` folder.
  - Class names are singular PascalCase (Enrollment).
  - Table names are plural snake_case, set explicitly: `@Entity({ tableName: 'enrollments' })`.
  - Fields are camelCase in code; MikroORM maps them to snake_case columns.
  - Add a field only when the feature that needs it is built. New columns on existing tables must be nullable or have a default.
  - Register entities with `MikroOrmModule.forFeature` in their own module. Never use another feature's entities or repositories directly; go through its exported service.
- Changes are saved only by `em.flush()`. Use one flush per use case, and `em.transactional()` when several changes must succeed or fail together.
- Outside an HTTP request (crons, scripts), never use the global EntityManager. Use `em.fork()` or `@CreateRequestContext()`.

<!-- gitnexus:start -->

# GitNexus — Code Intelligence

This project is indexed by GitNexus as **neo-bank** (2459 symbols, 4493 relationships, 41 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact before editing.** Use `impact({target: "symbolName", direction: "upstream"})` or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .`; report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- MUST warn on HIGH/CRITICAL `risk` pre-edit; never use `riskSharedAxes` to waive a HIGH/CRITICAL `risk` warning. Compare File/symbol: MCP File omits axes; Graph-RAG expands File.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- **MUST use `query({search_query: "concept"})` for concepts/flows, `context({name: "symbolName"})` for a named symbol, or `impact` for blast radius, on read-only callers, dependencies, imports, or execution flow.** Graph first; text search only for empty/`UNKNOWN`/literals.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource                                  | Use for                                  |
| ----------------------------------------- | ---------------------------------------- |
| `gitnexus://repo/neo-bank/context`        | Codebase overview, check index freshness |
| `gitnexus://repo/neo-bank/clusters`       | All functional areas                     |
| `gitnexus://repo/neo-bank/processes`      | All execution flows                      |
| `gitnexus://repo/neo-bank/process/{name}` | Step-by-step execution trace             |

## CLI

| Task                                         | Read this skill file                               |
| -------------------------------------------- | -------------------------------------------------- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md`       |
| Blast radius / "What breaks if I change X?"  | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?"             | `.claude/skills/gitnexus-debugging/SKILL.md`       |
| Rename / extract / split / refactor          | `.claude/skills/gitnexus-refactoring/SKILL.md`     |
| Tools, resources, schema reference           | `.claude/skills/gitnexus-guide/SKILL.md`           |
| Index, status, clean, wiki CLI commands      | `.claude/skills/gitnexus-cli/SKILL.md`             |

<!-- gitnexus:end -->
