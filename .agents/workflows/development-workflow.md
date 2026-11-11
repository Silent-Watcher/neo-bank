# Development Workflow

The mandatory development process for this repository when agent delegation
is available (ADR-023). The primary agent owns the entire lifecycle;
subagents provide specialized, independent results. Conventions that govern
all work (feature records, ADRs, commits) live in root `AGENTS.md`.

## Phase 1 — Session Initialization

1. The platform's SessionStart hook injects the instruction to invoke
   `project-explorer` (ZCode: plugin hook; Claude Code:
   `.claude/settings.json`).
2. The primary agent invokes `project-explorer` with a short task
   description and any focus areas.
3. The primary agent examines the Project Context Report
   (`.agents/schemas/project-context-report.md`) and reads additional
   documentation only when the task requires it.
4. Context established here is not re-derived later in the session.

## Phase 2 — Implementation

1. Understand the requested task; inspect relevant existing implementations.
2. Identify architectural and coding constraints (relevant ADRs, module
   boundaries, conventions).
3. Plan the changes; implement.
4. Track every changed and newly created file — they define the review
   scope. Untracked files must reach reviewers through file paths and
   content, not just diffs.

## Phase 3 — Code Review

1. Invoke `code-reviewer` once the implementation reaches a reviewable
   state. Dispatch: task description, implementation summary, changed file
   paths, git diff, review scope. For large changes, split into meaningful
   scopes with focused file lists and diff sections, keeping one common task
   summary.
2. On `CHANGES_REQUIRED`: inspect each finding, verify it against the actual
   code (the primary agent must not blindly apply recommendations), fix
   confirmed issues, update the change context, and re-invoke the reviewer
   with its own previous findings (`OPEN`/`FIXED`/`DISPUTED`), the updated
   diff, and a fix summary.
3. Repeat until approval or the iteration limit (see Review Loop Controls).
4. Never hide disputed findings.

## Phase 4 — Security Review

1. Start only after Code Review has passed. Invoke
   `code-security-analyzer` with the same change-based context. Never pass
   it the Code Reviewer's report or conclusions; approval there proves
   nothing about security.
2. On `SECURITY_CHANGES_REQUIRED`: verify findings, determine actual
   exploitability, implement justified remediations, and re-invoke with
   updated context.
3. Security approval is independent from Code Review approval.

## Phase 5 — Parallel Documentation and Testing

After both review gates pass:

- The primary agent writes/updates tests, executes the suites, inspects the
  actual Test Runner output, diagnoses failures, and fixes test or
  application issues. Test execution is never delegated to a subagent.
- In parallel, invoke `documentation-writer` with the change context and
  the governing Documentation Update Triggers (root `AGENTS.md`). It works
  without waiting for test results, but documents test statistics and
  execution results only from verified output the primary agent supplies.
- Write ownership must not overlap: only the primary agent touches source
  and tests; only `documentation-writer` touches documentation (hook
  enforced where available).
- If tests expose an implementation defect, the primary agent fixes it and
  determines which reviews must be repeated (see Phase 6 rules).

## Phase 6 — Final Reconciliation

1. Inspect all final changed files; verify documentation against the
   implementation; check manual testing scenarios.
2. Provide actual test results to `documentation-writer` when needed and
   request corrections if necessary.
3. Confirm that no approval was invalidated by later changes:
   - Application source changed → rerun Code Reviewer.
   - Security-relevant source changed → rerun Security Analyzer.
   - Both changed materially → rerun both, in the required order.
   - Test-only changes → review when quality or security impact warrants.
   - Documentation-only changes → no automatic re-review.
   - Configuration changes → decide by their impact.
4. Never treat an earlier approval as valid for source changes made
   afterward.

## Phase 7 — Final Validation

The primary agent runs all final validation itself, using only scripts that
exist in the repository (root `package.json` and workspace scripts):
tests, lint, format verification, typecheck, build. Never claim validation
passed without actual command results; investigate, fix, and rerun on
failure.

## Phase 8 — Completion

Declare the task complete only when implementation, review gates, security
review, documentation, testing, and validation are satisfied. Report
unresolved items explicitly. Never manufacture successful outcomes.

## Review Loop Controls

- Maximum 3 fix/re-review iterations per review phase by default.
- Finding IDs persist across iterations; the primary agent tracks each as
  `OPEN`, `FIXED`, or `DISPUTED` (code-review findings additionally flow
  into `docs/judge-findings.md` per root `AGENTS.md`).
- `SUGGESTION` findings never block approval.
- Never silently downgrade a finding to obtain approval; never rerun
  unrelated reviews unnecessarily.
- Escalate unresolved disagreements to the developer.
- When the iteration limit is reached, stop automatic remediation and
  report outstanding issues. Correctness takes precedence over reaching an
  approval state.
