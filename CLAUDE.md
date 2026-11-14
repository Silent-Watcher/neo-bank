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
