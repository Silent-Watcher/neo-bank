# _058 — Enrollment Master Prompt Phase 0: Business Domain and Database Governance Documentation

## Original Request

The developer pasted the "Neo Bank Enrollment — Phased Implementation Master
Prompt" (six phases: PostgreSQL 18 + UUIDv7 upgrade, core data model, step
data model, state machine and lazy expiration, OTP persistence, step
submission APIs) and mandated executing **Phase 0 only** — a
documentation-only phase establishing the Neo Bank business domain and
strict database constraint discipline in the governing documentation,
superseding the historical phone-number uniqueness rejection, and creating
the sequential prompt record. No application source, migrations, Docker,
dependency, or database changes; no commit.

## Approval Gate

The master prompt itself authorized Phase 0 directly ("MANDATORY: Execute
Phase 0 only"). Phase 0 requires no separate approval gate; the phase ends
at its stop condition — Phase 1 (PostgreSQL upgrade ADR) starts only on the
developer's explicit instruction.

## Implementation

- **`AGENTS.md` (root)** — new `## Neo Bank Business Domain` section after
  Project Overview: Enrollment purpose and the future account/card
  lifecycle; the one-non-expired-Enrollment-per-phone invariant (occupying
  statuses `INITIAL`/`IN_PROGRESS`/`PENDING_REVIEW`/`REJECTED`/`APPROVED`,
  `EXPIRED` releases, partial unique index enforcement, concurrency
  rationale, supersession pointers); expiration semantics (fixed instant set
  at creation, target creation + 24 hours, only `INITIAL`/`IN_PROGRESS`
  expirable, historical retention, identifier release); rejection semantics
  (correction-required on the existing record, no second Enrollment;
  `APPROVED` blocks by default until a future banking-lifecycle policy says
  otherwise).
- **`AGENTS.md` (root)** — new `### Strict Database Constraint Discipline`
  subsection at the top of "Database Entity and Migration Governance":
  intentional database contract per field (PostgreSQL type, nullability,
  length/precision, defaults, check/unique constraints, required indexes,
  lifecycle-dependent validity, referential integrity); incomplete records
  keep later-step fields nullable; no speculative constraints — unclear
  field semantics stop schema work until the developer approves the
  contract; row-existence invariants are enforced by database constraints
  such as partial unique indexes, not application lookups.
- **`apps/api/AGENTS.md`** — new Database Rules bullet referencing the root
  discipline (API-specific mirror).
- **`DEFERRED.md`** — entry 1 of the _051 section: the 2026-11-16
  phone-uniqueness rejection struck through with a dated supersession note
  (2026-11-22, partial unique index `WHERE status <> 'EXPIRED'`, root
  `AGENTS.md` pointer, migration lands with the first write path); the
  retention/backup/encryption and phone-shape decisions explicitly kept
  open.
- **`docs/judge-findings.md`** — Wave 21 SEC-02: dated supersession bullet
  appended; original finding text preserved.
- **`prompts/_058-enrollment-phase0-business-domain-docs.md`** — this
  record. The master prompt expected `_057`; `_057` was already taken (Redis
  idempotency), so the next sequential number `_058` is used per repository
  convention.
- **`docs/security-otp-enrollment.md`** — inspected, no change: it contains
  no phone-uniqueness statements (the master prompt's expectation did not
  match the file's actual content).
- **`docs/ai-decisions.md`** — entry #32: the Phase 0 supersession strategy.

## Key Decisions

- Supersession recorded as dated inline annotations (strikethrough + note in
  `DEFERRED.md`, appended bullet in SEC-02), never by deleting history —
  matches the registry's own convention and the findings-tracker integrity
  rules.
- No ADR for the invariant in Phase 0: the developer decision is already
  made (master prompt); the ADR proposal belongs to Phase 2, where the
  partial unique index DDL and legacy-data backfill strategy actually exist.
- `docs/current-state.md` and `docs/architecture.md` untouched: neither
  asserts any phone-uniqueness position, so nothing in them became
  inaccurate.

## Validation (docs-only, 2026-11-22)

Per the master prompt ("Do not run application tests or builds for this
documentation-only phase") and the root rule that docs-only changes skip
lint/test runs: no tests, builds, or formatters executed. Validation =
full `git diff` review of every changed file, plus cross-checks that every
location carrying the superseded rejection is annotated (`DEFERRED.md`,
`docs/judge-findings.md` SEC-02) and that no source, migration, or
configuration file changed. The code-reviewer/code-security-analyzer gates
are not applicable — no application source changed. Nothing committed.

## Deferred

Phase 1+ work stays strictly out of scope until the developer starts it:
PostgreSQL 18 + UUIDv7 ADR and infrastructure upgrade (Phase 1); core data
model with `publicId`/`expiresAt`/`status`/`currentStep` and the partial
unique index (Phase 2); step data model (Phase 3); state machine + lazy
expiration (Phase 4); OTP verification persistence (Phase 5); step
submission APIs (Phase 6). Open developer decisions carried by the master
prompt: phone canonical format (`09XXXXXXXXX` vs E.164), PII
encryption/retention/backup posture, legacy-data classification,
national-code and username normalization, `APPROVED` reapplication
semantics, Redis-consumed/PostgreSQL-write failure recovery contract.
