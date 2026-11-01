# Documentation Maintenance Rules

## User Request

The user asked for rules that make AI agents automatically update the
documentation set created in `_014`-era work (`docs/architecture.md`,
`docs/current-state.md`, per-app `AGENTS.md` / `ONBOARDING.md`, `README.md`)
whenever a feature is added, modified, or created — so documentation stays
current as a by-product of normal feature work rather than a separate effort.

## Implementation

- Root `AGENTS.md`, "Documentation and Context Management" section: replaced
  the vague "update relevant documentation" bullet with a **Documentation
  Update Triggers** table — a deterministic trigger → files mapping covering
  environment variables, features/endpoints, shared infrastructure and
  conventions, workspaces, dependencies, scripts/commands, ports/defaults,
  ADRs, naming/coding/testing conventions, and the catch-all "any statement
  in docs/ becomes inaccurate". Each trigger must be applied in the same
  task, before completion; unverifiable staleness must be reported instead
  of left silently wrong; "unsure whether material" resolves to updating.
- Root `AGENTS.md`, **Execution Process** step 5: now explicitly requires
  checking the trigger table and applying every matched entry.
- Root `AGENTS.md`, **Definition of Done**: a feature is not complete unless
  every matched trigger entry has been applied.
- `apps/api/AGENTS.md`, `apps/web/AGENTS.md`, `apps/admin/AGENTS.md`: added
  a pointer to the root trigger table naming the files each app typically
  needs to update, so agents working inside one app see the rule without
  loading the root file first.

## Validation

- Documentation-only change: no lint/test/typecheck runs (root rule for
  non-source changes). Relative links re-verified; only `AGENTS.md`,
  `README.md`, and new documentation files differ in the working tree.

## Remaining Limitations

- The rules rely on the agent reading `AGENTS.md`; they are process rules,
  not mechanically enforced (no CI check for doc staleness). A future
  CI/docs-drift check could enforce them mechanically if desired.
