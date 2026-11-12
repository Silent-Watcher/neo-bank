# 036 — AI Decision Log

## Original User Request

Introduce a project-wide rule requiring AI agents to document implementation
decisions they make independently (Task 2 of the four-task master prompt:
E2E test infrastructure, AI decision tracking, memory protection, and
environment configuration governance). The log must distinguish developer-
requested decisions, decisions established by existing documentation, and
decisions made independently by the agent; it must not duplicate existing
documentation systems, must flag ADR candidates without creating unapproved
ADRs, and the rule must be persistent and applicable to all applications in
the monorepo.

## Implementation

- **`docs/ai-decisions.md`** (new): the log. Defines what belongs (meaningful
  independent choices) and what does not (trivia, developer-requested choices,
  accepted-ADR territory), a boundary table against `DECISIONS.md`,
  `docs/judge-findings.md`, `DEFERRED.md`, and `prompts/`, the mandatory
  entry format (Task reference, Date, Context, Decision, Reasoning,
  Alternatives, Trade-offs, Impact, Reversibility, ADR Recommendation), and
  the statement that logging a decision never authorizes anything beyond what
  was already approved. Entries accumulate chronologically from this task
  onward; no backfill of historical decisions (they are documented in their
  per-feature prompt records).
- **Root `AGENTS.md`**: new `### AI Decision Log` section under `## Agent
  Workflow`, directly after `### Decision Records`. Mandatory post-task
  self-review of independent decisions, the recording requirement, the
  qualification rule, the no-duplication rule, the ADR-candidate rule, and
  the no-silent-architectural-decisions rule. Also added
  `docs/ai-decisions.md` to the specialized-documents list in the
  Documentation and Context Management section for discoverability.
- **`PROJECT_CONTEXT.md`**: Documentation Index row for the new file;
  "Last verified" refreshed to 2026-11-13.

## Decisions

- **Location `docs/ai-decisions.md`**: the task suggested `docs/AI-DECISIONS.md`
  but required following the repository's structure; existing `docs/` files are
  lowercase kebab-case, so the name was adapted.
- **Rule lives only in root `AGENTS.md`**: the root file already governs every
  task in every workspace ("Read this root file first; it applies to every
  task"), so per-app `AGENTS.md` copies would duplicate the rule. This was
  part of the approved proposal.
- **No ADR for the log itself**: it is a documentation/process convention
  established by the AGENTS.md rule, not an architecture change (per the
  approved proposal; revisitable).
- **No backfill**: historical decisions are already documented in prompt
  records (e.g. `_035`'s Decisions section); the log starts with this
  initiative.

## Validation

- Documentation-only change: no source code, tests, or configuration touched,
  so per the project rules no lint/test/typecheck runs were triggered for this
  task. Verified by inspection that the new section is discoverable from root
  `AGENTS.md` and indexed in `PROJECT_CONTEXT.md`.
- No code-reviewer/security gate for this task: the change contains no
  implementation code to judge (docs-only, consistent with how documentation-
  writer output was handled in `_035`).

## Notes

- The log is intentionally empty of entries at creation; entries are appended
  as Tasks 4 (env governance), 1 (E2E Testcontainers), and 3 (memory-based
  load shedding) are implemented in this same initiative, per the new rule.
- Not committed; awaiting explicit approval.
