# `.agents/` — Multi-Agent Development System

Platform-neutral home of the project's multi-agent development workflow
(ADR-023): canonical subagent definitions, the development workflow, report
schemas, and the ZCode plugin that packages the same subagents and hooks.
Supported platforms: **ZCode** (via the local `monorepo-workflow` plugin) and
**Claude Code** (via native project-level configuration).

```
.agents/
├── README.md                  ← this file
├── definitions/               ← canonical subagent definitions (single source of truth)
├── workflows/
│   └── development-workflow.md ← the mandatory development workflow
├── schemas/                   ← canonical report templates (both platforms)
└── plugins/
    ├── marketplace.json       ← ZCode local marketplace (root-level format)
    ├── .claude-plugin/
    │   └── marketplace.json   ← Claude Code marketplace manifest
    └── monorepo-workflow/     ← the plugin (manifest, generated agents, hooks)
```

## Subagents

| Canonical name           | Tools                                                           | Purpose                                                                                                                                                  |
| ------------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project-explorer`       | `Read, Grep, Glob`                                              | Establish session context at session start; produces the Project Context Report                                                                          |
| `code-reviewer`          | `Read, Grep, Glob`                                              | Independent quality judge; `APPROVED` / `APPROVED_WITH_SUGGESTIONS` / `CHANGES_REQUIRED`                                                                 |
| `code-security-analyzer` | `Read, Grep, Glob`                                              | Independent security judge (attacker's perspective); `SECURITY_APPROVED` / `SECURITY_APPROVED_WITH_INFORMATIONAL_FINDINGS` / `SECURITY_CHANGES_REQUIRED` |
| `documentation-writer`   | `Read, Grep, Glob, Write, Edit` (doc paths only, hook-enforced) | Keeps documentation synchronized with the implementation                                                                                                 |

Definitions in `definitions/` carry identity, description, responsibilities,
input expectations, output contract, restrictions, and review criteria.
The two reviewers are mutually independent: neither ever receives the
other's report or conclusions.

## Canonical definitions and synchronization

`scripts/agents/sync.mjs` reads `definitions/*.md` and generates:

- ZCode plugin agents → `.agents/plugins/monorepo-workflow/agents/` (adds
  ZCode `color` / `thoughtLevel` frontmatter; `tools` as an inline array)
- Claude Code agents → `.claude/agents/` (documented frontmatter format,
  `tools` comma-separated)
- the plugin manifest and both marketplace manifests (from one metadata
  block inside the script, so versions cannot drift)

`model` is deliberately omitted: each platform runs subagents on its session
model. Generated files are committed — never edit them; edit the canonical
definition and re-run:

```sh
node scripts/agents/sync.mjs          # (re)generate all platform artifacts
node scripts/agents/sync.mjs --check  # non-mutating drift check; exit 1 on drift
```

To add a subagent: create `.agents/definitions/<name>.md` (frontmatter:
`name`, `description`, `tools`), add presentation metadata in
`AGENT_PRESENTATION` in `scripts/agents/sync.mjs`, run the sync, and update
this README, the workflow document, and root `AGENTS.md`. To add a platform:
write another adapter in the sync script consuming the same definitions.

## ZCode: plugin and local marketplace

The plugin `.agents/plugins/monorepo-workflow/` carries
`.claude-plugin/plugin.json` — the manifest path ZCode recognizes as its
compatibility fallback and Claude Code natively — plus `agents/` and
`hooks/` (`hooks/hooks.json` with `SessionStart` and `PreToolUse` entries).

**One-time install (manual, per developer — a plugin inside the repository
is never auto-enabled):**

1. Open ZCode **Settings → Plugin Management → Discover → + (Add Plugin
   Marketplace)** and add this directory: `<repo>/.agents/plugins`
2. In the **neo-bank-agents** marketplace, install **Neo Bank Monorepo
   Workflow** and make sure it is enabled.
3. Restart the session; verify under the plugin's detail view that the two
   hooks are listed as runnable.

**Update:** after pulling changes to the plugin (agents, hooks, manifest),
refresh the marketplace/plugin from the same UI (or reinstall); the version
in `scripts/agents/sync.mjs` (`PLUGIN.version`) must be bumped when plugin
content changes so the update is visible.

**Runtime requirement:** the hook commands invoke `node`; the ZCode client
process must have Node.js on its `PATH` (it is on this machine via nvm).

## Claude Code: project-level configuration

- Subagents: `.claude/agents/*.md` (generated, committed) — discovered with
  zero installation from a fresh clone.
- Hooks: `.claude/settings.json` — `SessionStart` (matcher `startup`) runs
  `session-start.mjs`; `PreToolUse` (matcher `Write|Edit`) runs
  `guard-documentation-write.mjs`. Both reference the single script sources
  under `.agents/plugins/monorepo-workflow/hooks/`.

## Session initialization behavior

Both SessionStart hooks emit an `additionalContext` block instructing the
primary agent to invoke `project-explorer` before substantive work. A hook
cannot invoke a subagent itself; delegation is performed by the primary
agent. The explicit session-init rule in root `AGENTS.md` is the binding
fallback if a hook is missing, disabled, or fails (hook scripts fail open —
a broken hook never blocks the session).

## Permission enforcement

Enforced by platform mechanisms, not by prompt alone:

- Tool allowlists: the three read-only agents have no `Write`/`Edit`/`Bash`;
  no subagent can execute commands or tests.
- Documentation-only writes: the `PreToolUse` guard denies `Write`/`Edit`
  outside documentation paths **only when the hook input identifies the
  caller as `documentation-writer`** (verified: Claude Code exposes
  `agent_type` for subagent tool calls; ZCode exposes `agent_type` = the
  agent name of the session, `zcode-<agentType>` for plugin subagents). All
  other callers pass through untouched. Offline check:
  `node .agents/plugins/monorepo-workflow/hooks/guard-documentation-write.mjs --self-test`
- If a platform version stops exposing agent identity, fall back to the
  read-only patch mode documented in the `documentation-writer` definition.

## Context delivery (token efficiency)

Dispatches to reviewers carry: task description, implementation summary,
changed file paths (including untracked files), the relevant git diff
(`git status --short`, `git diff --name-only`, `git diff --unified=…`,
`git diff --cached`), review scope, and for re-reviews that reviewer's own
previous findings with `OPEN`/`FIXED`/`DISPUTED` status and a fix summary.
Never whole files or the whole repository; reviewers read surrounding code
themselves with their read tools. Redact secrets from all shared context.

## Review iteration policy

Maximum 3 fix/re-review iterations per review phase. Finding IDs persist
across iterations and are tracked as `OPEN`, `FIXED`, or `DISPUTED`.
`SUGGESTION` findings never block approval. Never silently downgrade a
finding to obtain approval; escalate unresolved disagreements to the
developer. Unrelated reviews are not re-run after unrelated changes.
