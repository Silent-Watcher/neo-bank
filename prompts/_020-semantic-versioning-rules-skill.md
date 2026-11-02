# Semantic Versioning Rules & Skill

## User Request

The user asked to introduce Semantic Versioning and Git release management
for the monorepo by (1) adding a concise "Semantic Versioning & Release
Rules" section to the root `AGENTS.md` and (2) creating a
`semantic-versioning` Skill with the complete practical workflow (strategy
detection, change analysis, increment decisions, pre-1.0.0 policy, version
updates, tagging, verification/reporting). No actual release, version
change, tag, or release tooling was allowed.

## Implementation

- **Inspection findings**: skills live in `.agents/skills/<name>/SKILL.md`
  with YAML frontmatter (`name`, `description`) and are auto-discovered
  (existing: `nest-config`, `nestjs-best-practices`, `turborepo`). No Git
  tags exist. All four `package.json` files (root + three apps) are private
  workspaces at `0.0.0`, independently versioned — so the strategy to
  preserve is **independent-package versioning**, currently pre-1.0.0 and
  never released.
- **Root `AGENTS.md`**: new "Semantic Versioning & Release Rules" section —
  SemVer 2.0.0, increment criteria (highest-wins), release-task-only
  version bumps, decisions from actual diffs vs the latest tag, tags match
  versions and are annotated, never overwrite tags or push tags / create
  release commits without authorization, never bump unrelated workspaces.
- **`.agents/skills/semantic-versioning/SKILL.md`**: complete workflow —
  (A) strategy detection with this repo's concrete state recorded,
  (B) change analysis table against the latest applicable tag (committed and
  uncommitted changes; commit messages are hints, never the basis),
  (C) PATCH/MINOR/MAJOR/no-change rules with repo-specific examples,
  (D) pre-1.0.0 policy (breaking changes increment MINOR; MAJOR stays 0;
  1.0.0 is an explicit decision; pre-release suffix semantics) with a worked
  example, (E) version update procedure (affected packages only, no
  `workspace:` protocol introduction, lockfile only when required, no new
  tooling), (F) tagging (`<package-name>@<version>` default for this repo,
  `v<version>` for repository-wide releases; annotated; tag the release
  commit), (G) verification checklist and the mandatory report contents.
- No versions changed, no tags created, no dependencies or scripts added.

## Validation

Documentation-only change: per the root AGENTS.md rule, no lint/test/build
runs were executed because no source code changed. Files were formatted to
match the repository's Markdown conventions.

## Notes for Agents

- Discovery: the Skill is picked up automatically from
  `.agents/skills/semantic-versioning/SKILL.md` alongside the existing
  skills, and is triggered by release/version-bump/tag tasks via its
  description.
- The permanent rules (root `AGENTS.md`) stay concise; the operational
  procedure lives only in the Skill, so the two do not duplicate each other.
