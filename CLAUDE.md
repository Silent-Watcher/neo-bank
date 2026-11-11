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
