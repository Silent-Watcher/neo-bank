# _033 — Project-Level Multi-Agent Development Workflow (ZCode + Claude Code)

- **Date:** 2026-11-11
- **Status:** Implemented (uncommitted)
- **ADR:** ADR-023 (Accepted — first repository write of this feature)

## Original request (condensed)

Establish a cross-platform, project-level multi-agent development workflow for
the monorepo, supporting both the ZCode agent and Claude Code, with a
platform-neutral instruction layer extensible to future agents. All
configuration, definitions, hooks, and scripts version-controlled in the
repository; no application-feature changes; no commits.

Key requirements: mandatory initial discovery of real platform capabilities
(no assumptions); single source of truth for agent behavior in
`.agents/definitions/`; platform adapters generating native files
(ZCode: local plugin + marketplace under `.agents/plugins/` with
plugin-based subagents; Claude Code: project-level `.claude/agents/`);
dependency-free sync script (`scripts/agents/sync.mjs`, `--check` mode);
exactly four subagents (`project-explorer`, `code-reviewer`,
`code-security-analyzer`, `documentation-writer`) with enforced native tool
restrictions and independent reviewers; SessionStart hooks injecting the
`project-explorer` instruction on both platforms (with the explicit
AGENTS.md rule as fallback); change-based context delivery; a mandatory
development workflow with review-loop controls (max 3 iterations, finding-ID
persistence, `OPEN`/`FIXED`/`DISPUTED`); canonical report schemas under
`.agents/schemas/`; documentation of the system; an approval gate before
implementation.

## Implementation record

1. **Discovery (verified, not assumed):** ZCode 3.17.2 plugin/marketplace/
   hook/agent formats verified from the installed client's official plugins
   and configuration-guide skills; Claude Code 2.1.316 verified from the
   installed CLI (`claude plugin validate`) and its embedded hook
   documentation. Hook-input payload fields confirmed from the binaries:
   Claude Code exposes `agent_type` ("Agent type name … present when the
   hook fires from within a subagent (alongside agent_id)"); ZCode builds
   hook stdin with `agent_type: e.agentName` and names subagent sessions
   `zcode-<agentType>`. Both support SessionStart `additionalContext`
   injection (output shapes extracted from the binaries/schemas).
2. **ADR-023** written into `DECISIONS.md` first (Accepted, per approval).
3. **Canonical definitions** `.agents/definitions/{project-explorer,code-reviewer,code-security-analyzer,documentation-writer}.md`
   — frontmatter identity/tools + responsibilities, input expectations,
   output contract, restrictions, review criteria; reviewer independence and
   context-delivery rules embedded.
4. **Sync script** `scripts/agents/sync.mjs` (dependency-free ESM):
   generates ZCode plugin agents (adds `color`/`thoughtLevel`, inline tools
   array), Claude Code agents (comma-separated tools), the plugin manifest
   (`.claude-plugin/plugin.json`, the manifest path both platforms
   recognize), and both marketplace manifests — all from one metadata block.
   `--check` is a non-mutating drift check; write mode removes orphaned
   generated agents.
5. **ZCode plugin** `.agents/plugins/monorepo-workflow/` + marketplaces
   (`.agents/plugins/marketplace.json` for ZCode,
   `.agents/plugins/.claude-plugin/marketplace.json` for Claude Code).
   Install is a documented one-time manual UI step (Settings → Plugin
   Management → Discover → + → add `.agents/plugins` → install → enable).
6. **Hooks** (`.agents/plugins/monorepo-workflow/hooks/`):
   `session-start.mjs` (platform-shaped `additionalContext` instruction to
   invoke `project-explorer`; fail-open; stdin byte-cap + timeout) and
   `guard-documentation-write.mjs` (denies `Write`/`Edit`/`MultiEdit`/
   `NotebookEdit` outside documentation paths **only for the
   `documentation-writer` identity**; symlink-resolving path containment;
   fail-open; `--self-test` with 33 assertions). Wired via the plugin's
   `hooks.json` (ZCode) and `.claude/settings.json` (Claude Code), both
   matcher `Write|Edit|MultiEdit|NotebookEdit` for PreToolUse and `startup`
   for SessionStart. Since both platforms expand `${CLAUDE_PLUGIN_ROOT}` and
   accept `type: "command"`, one platform-neutral hooks.json serves both.
7. **Claude Code** `.claude/settings.json` + generated `.claude/agents/`
   work from a fresh clone with zero install. Root `CLAUDE.md` (new)
   imports `@AGENTS.md`.
8. **Shared instructions:** concise "Multi-Agent Development Workflow"
   section in root `AGENTS.md` (session init, review gates, parallel phase,
   context delivery, iteration control, platform setup, no-delegation
   fallback).
9. **Workflow + schemas:** `.agents/README.md` (architecture, setup, sync,
   enforcement, extension), `.agents/workflows/development-workflow.md`
   (phases 1–8, review loop controls), `.agents/schemas/` (4 report
   templates).
10. **Docs per triggers:** `docs/current-state.md` (ADR-023 status),
    `PROJECT_CONTEXT.md` (conventions + documentation index).

## Decisions

- **Documentation-writer enforcement = hook guard, verified viable:** the
  decision in ADR-023 was verification-driven; verification confirmed both
  platforms expose subagent identity to PreToolUse hooks, so the guard path
  was implemented (the read-only patch fallback remains documented in the
  definition for platforms that stop exposing identity).
- **One manifest, one hooks.json:** the `.claude-plugin/` paths and
  Claude-compatible field shapes were chosen because ZCode reads them as its
  compatibility format — verified by ZCode's official plugins using the same
  conventions.
- `model` omitted everywhere: each platform runs subagents on its session
  model.

## Judge review

Context-blind judge (isolated agent, code + minimal technical context only),
three review rounds on the three scripts (tracked as Wave 4 in
`docs/judge-findings.md`):

- **Round 1:** 17 findings (2 Medium, 15 Low, 0 Critical/High) — all applied
  as in-scope hardening: guard extended to MultiEdit/NotebookEdit, realpath
  containment, last-segment agent identity, orphan-agent removal in sync
  write mode, stdin cap/timeout, unknown-CLI-arg rejection, fail-loud
  definition validation.
- **Round 2:** verified round-1 remediations correct; found 4 new/residual
  issues introduced by the fixes (R1 BOM slicing off-by-one, R2 prototype
  -chain duplicate-key false positive, R3 main-module gating silently
  disabling hooks under symlinked invocation, R4 Medium — dangling symlinks
  bypassing containment). All four applied: BOM stripped once at load,
  `Object.hasOwn`, gating removed/realpath-normalized per file, and
  `resolveRealPath` replaced by `containsSymlinkComponent` (any symlinked
  component — resolvable, dangling, broken — is denied outright).
- **Round 3:** verified R1–R4 closed; `session-start.mjs` and
  `guard-documentation-write.mjs` clean with no actionable findings;
  `sync.mjs` raised R5 (an out-of-isolation verification request), resolved
  from existing evidence: `claude plugin validate` reads and passes
  `hooks/hooks.json`, and the `./`-prefix manifest shape was adopted because
  the previous shape produced four hard validator errors.

## Validation results

- `node scripts/agents/sync.mjs --check` — 11/11 generated files match.
- `claude plugin validate .agents/plugins/monorepo-workflow` — **passed**
  (remaining notices are catalog-submission-only: LICENSE/icon absent — this
  plugin is never submitted to a catalog; root-README `documentationUrl`
  warning is a pre-existing README quirk outside this task).
- `claude plugin validate .agents/plugins` (marketplace) — **passed**.
- `.claude/settings.json` — valid JSON; hooks reference existing script
  paths.
- `guard-documentation-write.mjs --self-test` — 33 assertions passed
  (synthetic decision cases, output-shape contracts, live symlink
  containment for resolvable/dangling/broken links).
- Session-start hook — both output shapes verified by running with/without
  `ZCODE_*` env.
- oxfmt applied to the three scripts; behavior re-verified after formatting.
- Permission audit — generated agent frontmatter: the three read-only agents
  carry exactly `Read, Grep, Glob`; `documentation-writer` carries `Read,
  Grep, Glob, Write, Edit`; no subagent has `Bash`.

## Pending runtime verification (requires human action)

- ZCode: install the plugin (one-time UI step, `.agents/README.md`), restart
  a session, and confirm in the plugin detail view that the four agents and
  two hooks load; verify the SessionStart instruction appears. Static
  evidence is strong (ZCode expands `${CLAUDE_PLUGIN_ROOT}`, accepts the
  compat manifest and `command` hooks, and its hook runner auto-enables from
  plugin hooks), but live behavior was not observable from this session.
- Claude Code: start a normal session in the repo and confirm the
  session-start instruction appears and `documentation-writer` writes are
  path-guarded. (The `agent_type` hook contract was verified from the
  installed binary's documentation strings, not a live subagent call.)
- `node` on the GUI process `PATH` is a runtime requirement for the ZCode
  hooks (documented in `.agents/README.md`).

## Known limitations

- Git LFS: `.gitattributes` maps `*.md` through LFS and git-lfs is not
  installed on this machine — staging/committing the new Markdown files will
  fail until git-lfs is installed (`git lfs install --local`).
- SessionStart hooks inject instructions; delegation itself is enforced by
  the AGENTS.md rule, not by the platform.
- ZCode plugin enable state lives in each developer's `~/.zcode/cli/config.json`.
