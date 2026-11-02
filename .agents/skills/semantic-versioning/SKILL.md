---
name: semantic-versioning
description: Plan and execute semantic-versioning releases in the Turborepo monorepo. Use when a task asks to release, bump a version, cut a release tag, decide MAJOR/MINOR/PATCH, or evaluate whether changes are breaking — including the pre-1.0.0 policy and the independent-package versioning strategy.
---

# Semantic Versioning & Release Workflow

Operational workflow for versioning and tagging releases in this repository.
The permanent rules live in the root `AGENTS.md` ("Semantic Versioning &
Release Rules"); this Skill turns them into a step-by-step procedure.
Reference: [SemVer 2.0.0](https://semver.org/spec/v2.0.0.html).

Hard boundaries: never change a version outside an explicit release task,
never push tags or create release commits without explicit authorization,
and never introduce release tooling (Changesets, semantic-release, scripts).

## A. Determine the Versioning Strategy

1. Read every workspace `package.json` (`package.json`, `apps/*/package.json`)
   and note each package's `name` and `version`.
2. Inspect the existing tags with `git tag --list` and
   `git log --oneline --decorate` to find the latest applicable release.
3. Classify the strategy before deciding anything:
   - **Single-version:** one version represents the whole repository.
   - **Independent-package:** each workspace versions itself separately.

   This repository uses **independent-package versioning**: every workspace
   (`@neo-bank/api`, `@neo-bank/web`, `@neo-bank/admin`, the root) carries its
   own `package.json` version, with no cross-package synchronization. Do not
   convert it to single-version (or a tool like Changesets) — preserve the
   existing convention.

4. If tags already exist, adopt their naming convention; do not invent a new
   one. If none exist (current state), use the convention in section F.

## B. Analyze the Changes

Compare the working tree (committed **and** uncommitted changes) against the
latest applicable release tag with `git diff <tag>` (or the full history when
no tag exists — the current state of this repository). Commit messages are a
hint, never the basis for a decision; read the actual diffs.

Classify every meaningful change by its externally observable impact:

| Area                          | What to look for                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| Public API                    | Removed/renamed endpoints, changed routes or versioning, dropped methods, changed exports |
| HTTP contracts                | Request/response shapes, status codes, error codes, envelope or Problem Details changes   |
| Exported types and interfaces | Breaking type changes, removed exports, narrowed signatures                               |
| Application behavior          | Changed defaults, changed side effects, changed security-sensitive semantics              |
| Configuration and environment | New required variables, removed/renamed variables, changed validation rules               |
| Data compatibility            | Redis key/convention changes, persisted format changes, migration requirements            |
| New features                  | New endpoints, new capabilities, new supported inputs                                     |
| Bug fixes                     | Corrections of incorrect released behavior                                                |
| Dependency updates            | Only when they change externally observable behavior (e.g. a framework major upgrade)     |

## C. Decide the Increment

Apply the highest increment required by any single change:

- **PATCH** — backward-compatible bug fixes and internal corrections that do
  not change observable behavior.
- **MINOR** — backward-compatible functionality additions, and public API
  deprecations (deprecation notices, not removals).
- **MAJOR** — backward-incompatible public API, behavior, or data contract
  changes (breaking endpoint contracts, removed exports, changed key formats
  that require action by consumers).
- **No version change** — documentation-only, test-only, formatting, CI-only,
  and internal refactoring that does not affect released behavior or public
  contracts.

Examples:

- Renaming `POST /enrollments/challenge` → another path, or changing its
  response shape → **MAJOR** (breaking HTTP contract).
- Adding `POST /enrollments/verify` with no changes to existing endpoints →
  **MINOR**.
- Fixing a wrong error message or an incorrect TTL → **PATCH**.
- Editing only `AGENTS.md`, specs, or formatting → **no version change**.

## D. Pre-1.0.0 Policy

While the major version is `0` (initial development):

- Bug fixes increment **PATCH** (`0.1.4` → `0.1.5`).
- New features increment **MINOR** (`0.1.4` → `0.2.0`).
- Breaking changes also increment **MINOR**, never MAJOR (`0.1.4` → `0.2.0`).
- MAJOR stays `0` until initial development ends; moving to `1.0.0` is an
  explicit release decision that must be called out and approved in the
  release task, not chosen silently.

Example: `0.3.2` with one breaking endpoint change and one new feature
becomes `0.4.0` — both changes fold into the single MINOR increment.

Pre-release suffixes (`alpha`, `beta`, `rc`) follow SemVer precedence:
`0.4.0-beta.1` → `0.4.0-beta.2` → `0.4.0` → `0.5.0`. Use them only when a
release explicitly calls for a staged rollout; never leave a pre-release tag
as the latest release without intending it.

## E. Update Versions

1. Calculate the next version from the current version and the decided
   increment (section C/D). Spell out the calculation in the report.
2. Update **only** the `package.json` files of packages whose behavior or
   contracts changed. Do not touch unaffected workspaces.
3. Preserve workspace conventions: dependency ranges in this monorepo use
   explicit version ranges or `*` for internal workspace references — do not
   introduce `workspace:` protocol or sync versions across packages.
4. Run the package manager only if it must refresh metadata (e.g.
   `pnpm install` after a version change that the lockfile records). Never
   add dependencies or release tooling as part of a release.
5. Commit the version updates in the release commit (only with explicit
   authorization), so the tag in section F can point at it.

## F. Tag the Release

1. Inspect `git tag --list` first; never reuse or overwrite an existing tag.
2. Prefer **annotated** tags (`git tag -a <name> -m "<message>"`).
3. Naming:
   - Repository-wide release: `v<version>` (e.g. `v1.2.3`).
   - Independent package release: `<package-name>@<version>`
     (e.g. `@neo-bank/api@0.4.0`).
     This repository uses independent-package versioning, so the
     `<package-name>@<version>` form is the default; use `v<version>` only when
     a release deliberately covers the whole repository.
4. Tag the commit that contains the corresponding `package.json` version
   update — never uncommitted changes, never an unrelated commit.
5. Never push tags without explicit authorization.

## G. Verify and Report

Before reporting completion, verify:

- Every updated `package.json` parses and carries exactly the intended
  version.
- Tag name(s) (when authorized to create them) match the corresponding
  `package.json` versions exactly and point at the release commit.
- The release scope matches the change analysis: no unrelated package was
  bumped, no unrelated file was modified.
- Validation relevant to the changed packages was executed and its real
  results reported (never claim a check passed without running it).

The final report must state:

1. Affected packages.
2. Previous and proposed versions for each.
3. Increment type (MAJOR / MINOR / PATCH / pre-release).
4. The reason, grounded in the actual changes (cite the breaking or new
   behavior).
5. Git tag status: existing tags inspected, tag created (or not), tag target
   commit.
6. Modified files.
7. Validation results.
