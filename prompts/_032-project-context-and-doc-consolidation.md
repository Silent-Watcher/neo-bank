# 032 — Project Context, Documentation Consolidation & Git LFS

## Original request

Master prompt (Persian intro): repository context optimization and
documentation consolidation — create a root `PROJECT_CONTEXT.md` as the
primary context reference, audit and classify all Markdown documentation
(agent instructions / core context / specialized / redundant), update the
root `AGENTS.md` with a context-loading policy and progressive loading rules,
configure Git LFS for Markdown, adopt conditional validation (no application
validation for documentation-only changes), and prepare a deletion proposal
for redundant docs (no deletions without explicit approval). No final report.

## Implementation

- Created `PROJECT_CONTEXT.md`: compact overview (apps table, API
  architecture layers, config/response/Redis/logging contracts, testing,
  infrastructure, conventions) + documentation index. Thin-index design:
  points to `docs/architecture.md` / `docs/current-state.md` for depth
  instead of duplicating them (user was asked; no answer given, so the
  recommended thin-index option was taken — no core-doc merge/deletion).
- Root `AGENTS.md`: context-loading policy added to "Documentation and
  Context Management" (read `PROJECT_CONTEXT.md` at session start,
  progressive loading rules, maintenance rule), plus a Documentation Update
  Triggers row for `PROJECT_CONTEXT.md`.
- `.gitattributes`: LFS tracking for `*.md` plus image (`png jpg jpeg gif
  webp avif ico svg`) and font (`woff woff2 ttf otf`) patterns for future
  assets (user request). No `.mdx`/`.markdown` files exist. Verified with
  `git check-attr` on root, `prompts/`, and nested app paths.
- Doc audit (subagent, all 106 Markdown files inventoried by directory):
  agent instructions (root + app AGENTS.md, `.agents/rules`, `.agents/skills`)
  stay separate; specialized docs stay independent and are indexed;
  `prompts/` records are deliberate history.

## Accuracy fixes found by the audit (documentation-only)

- Compose restructure (`compose.dev.yml`/`compose.prod.yml` → `compose.yml`,
  `compose.app.dev.yml`, `compose.app.prod.yml`, `compose.prod.all.yml`) was
  undocumented: fixed stale references and the command equivalents in
  `docs/docker.md` (files table + commands) and the unused `DD` helper in
  `docs/observability/manual-testing.md`.
- `learning-guide.fa.md` was intentionally removed by the user (educational
  material, moved out of the repo): removed the broken link from
  `README.md` and `docs/observability/roadmap.md` and the stale prose
  mentions from `docs/docker.md`, `docs/current-state.md`,
  `docs/observability/README.md`. Historical records (ADR bodies in
  `DECISIONS.md`, `docs/judge-findings.md`) intentionally keep their
  original wording.
- `.agents/rules/nest-config.md`: factories path corrected
  `src/config/` → `src/shared/config/` (verified against the actual tree).

## Decisions

- Git LFS: user explicitly chose to configure it despite the trade-off
  recommendation (docs are 0.6 MB text; LFS degrades diffs/blame and consumes
  GitHub LFS bandwidth). git-lfs is **not installed** on the host — patterns
  are in place but inert until the user installs git-lfs and runs
  `git lfs install --local`; until then, committing `.md`/image/font files
  will fail on the missing `lfs` filter. No historical migration performed
  (requires explicit approval per the prompt).
- Deletion proposal (pending user approval, not executed): delete the six
  tracked `.zcode/plans/plan-session_*.md` files — session planning
  artifacts whose content is fully realized in the codebase and superseded by
  the `prompts/` records and ADRs. No unique information would be lost
  beyond historical planning narrative.

## Validation

Documentation-only task: no lint/test/build/format runs (conditional
validation policy). Checks performed: `git check-attr` pattern verification;
grep sweeps confirming no stale `compose.dev.yml`/`compose.prod.yml`/
`learning-guide` references remain in live docs; compose project names
verified from file headers (`neo-bank-dev`, `neo-bank-prod`,
`neo-bank-monitoring`). Unverified: effective Compose project name when
running through the new orchestrator files (`compose.yml`,
`compose.prod.all.yml` carry no `name:` field) — needs a live
`docker compose ls`/`ps` to confirm; docker.md no longer asserts project
names for the orchestrators.
