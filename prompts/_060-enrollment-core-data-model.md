# _060 — Enrollment Core Data Model (Enrollment Master Prompt Phase 2)

## Original Request

Phase 2 of the Enrollment master prompt: add the minimum lifecycle and
identity fields to the existing `Enrollment` entity — resolve phone
canonicalization and legacy-data decisions, prepare the complete
field-constraint matrix, implement the approved status/step enums, add
`publicId` (PostgreSQL-native `uuidv7()`), `expiresAt`, `status`,
`currentStep`, and the partial unique index enforcing one non-expired
Enrollment per phone number, generate and review a new migration, and add
entity metadata and PostgreSQL integration tests. No OTP integration yet;
stop after the model and migration are verified.

## Approval Gate

Two structured decisions were presented and approved by the developer:
canonical phone storage (**A: `09XXXXXXXXX` national format**) and the
field-constraint matrix + migration plan (including the uuidv7 CHECK).
Per the ADR-first workflow, **ADR-041 was the first repository write**
(`DECISIONS.md`, Accepted, 2026-11-22), amended once during implementation
per the developer's direct direction (`varchar` → `text` for
`status`/`current_step`; `nvarchar` does not exist in PostgreSQL and plain
`varchar` is physically identical to `text` — `text` is the idiomatic
spelling when no length limit is part of the contract).

## Implementation

- **`enrollments.enums.ts` (new)** — single source of the lifecycle
  vocabulary: `ENROLLMENT_STATUSES` (6 values), `ENROLLMENT_STEPS` (9 values
  in master-prompt §7.4 order), `EXPIRABLE_ENROLLMENT_STATUSES`
  (`INITIAL`/`IN_PROGRESS`), named `ENROLLMENT_INITIAL_STATUS`/`STEP`,
  `ENROLLMENT_STATUS_EXPIRED`, `ENROLLMENT_TTL_MS` (24 h). Check-constraint
  expressions are composed from these arrays — no value list is duplicated.
- **`enrollment.entity.ts`** — adds the approved core properties to the
  inherited `BaseEntity` columns: `phoneNumber` (`varchar(11)`, canonical
  national format; the stale E.164 doc claim corrected), `publicId`
  (`uuid`, `defaultRaw: 'uuidv7()'`, database-generated and read back after
  insert), `status`/`currentStep` (`text`, defaults from the enums,
  initializer pattern per the BaseEntity conventions), `expiresAt`
  (initialized from `this.createdAt` + `ENROLLMENT_TTL_MS` — parent class
  fields initialize before subclass fields, so one clock reading produces
  both; no database default). Class-level `@Check`s (phone format, uuidv7
  version, status list, step list) and `@Unique`s (`public_id` unique;
  partial unique phone index `WHERE status <> 'EXPIRED'` composed from
  `ENROLLMENT_STATUS_EXPIRED`).
- **Migration `Migration20261122000737`** — generated from the metadata
  diff against the dev PostgreSQL, inspected, and corrected before first
  application: `expires_at` is added nullable, backfilled from each row's
  own `created_at`, then `SET NOT NULL` (the generator emits a bare
  `not null` add that only works on empty tables); the phone narrowing
  carries a comment documenting its empty-table precondition (explicit
  casts to `varchar(n)` truncate silently). An abandoned intermediate
  migration (`Migration20261122000228`, never applied) and its poisoned
  snapshot were deleted and the migration regenerated fresh — the v7
  `migration:create` diffs against `.snapshot-*.json`, not the database.
- **`enrollment.entity.spec.ts`** — extended metadata verification: own
  property list, `varchar(11)`/`uuid`/`text`/`timestamptz(3)` column types,
  `uuidv7()` defaultRaw, text columns' defaults, expires_at having no
  database default, the four check constraints, and both unique definitions
  including the partial-index predicate.
- **`enrollment.db-spec.ts`** — the round-trip test now proves the
  database-generated version-7 `publicId` (regex + `uuid_extract_version`),
  defaults, and the 24-hour expiry delta; eight new PostgreSQL-level
  contract tests: second-active-phone rejection, per-status blocking for all
  five non-expired statuses, expired release + shared historical EXPIRED
  rows, varchar(11) length cap vs format CHECK layering, unknown
  status/step CHECK violations, no-database-default for `expires_at`, and
  raw-insert uuidv7 generation. Raw fixtures supply `created_at`/`expires_at`
  explicitly (neither has a database default).

## Key Decisions

- **Canonical phone storage = `09XXXXXXXXX`** (ADR-041 Decision 1): matches
  the single normalization seam (`toNationalMobile`) already shared by the
  OTP storage, rate limits, and the ADR-039 idempotency scope; E.164 is a
  presentation concern, never storage.
- **`text` for `status`/`current_step`** (ADR-041 amendment per developer
  direction); `varchar(11)` kept for the phone (fixed-format identifier —
  the length is the contract).
- **`expires_at` has no database default** (ADR-041 Decision 5): the
  application sets it from the same clock reading as `createdAt`; a DB
  `now() + interval` default would pair a second clock with the app-clock
  creation instant (master prompt §7.2).
- **Legacy data**: `enrollments` holds 0 rows (verified pre/post Phase 1) —
  no duplicate classification needed; the backfill is still written
  generally correctly.
- **Migration review fallback**: the dedicated `migration-reviewer` subagent
  is not registered on this platform; the `code-reviewer` subagent performed
  the migration-review role against the same checklist plus the primary
  agent's own structured review (documented fallback per root `AGENTS.md`).
  Verdict APPROVED_WITH_SUGGESTIONS — MIG-01 resolved (precondition
  comment), MIG-02 Won't Fix with justification (snapshot semantics),
  MIG-03 deferred (`DEFERRED.md` entry). Tracked in
  `docs/judge-findings.md` Wave 30.

## Validation (all executed, 2026-11-22)

- Migration applied to the dev Compose PostgreSQL (`db:migration:up`);
  `\d enrollments` verified: every column, default, CHECK (5), the
  `enrollments_public_id_unique` constraint, and the partial unique index
  `WHERE status <> 'EXPIRED'`.
- Unit tier: 54 files / **504 tests passed**.
- DB tier (Testcontainers, `postgres:18.7-alpine`): 4 files / **36 tests
  passed** — includes the eight new invariant/contract tests.
- Full sweep: no stale E.164 or `varchar(255)` phone claims remain outside
  historical records.
- Review gates: migration review APPROVED_WITH_SUGGESTIONS (Wave 30,
  fallback reviewer); code review CHANGES_REQUIRED → remediated →
  APPROVED_WITH_SUGGESTIONS on re-review (Wave 31, iterations 2 of 3); code
  security SECURITY_APPROVED_WITH_INFORMATIONAL_FINDINGS (Wave 32, three
  informational findings tracked). All tiers re-verified green after every
  remediation wave (typecheck + unit 504/504 + db 36/36; e2e 115/115 and
  redis 89/89 on the final full run).

## Deferred

- Migration-replay parity smoke test (`DEFERRED.md` _060 entry 1, MIG-03).
- Pool-lifecycle test relocation to a lifecycle-focused db-spec
  (`DEFERRED.md` _060 entry 2, CR-07).
- db-spec fixture parameterization + matcher conversions landed before the
  commit (`DEFERRED.md` _060 entry 3 marked Done, CR-10 Resolved — the
  Mimosa gate had blocked Edit-tool writes mid-remediation; the helper was
  replaced via a structural rewrite script at the developer's explicit
  direction, removing the interpolation entirely).
- Phase 4/5 write-path payload constraints: explicit payload construction,
  DTO key exclusion, regression test, and the uuidv7 timestamp disclosure
  note (`DEFERRED.md` _060 entry 4, SEC-03/SEC-01).
- Phase 4 constraint (CR-08, documented on the entity): the Enrollment
  creation service must never accept or forward `createdAt`/`expiresAt` —
  hydration assigns provided values after the constructor, which would
  silently break the 24-hour invariant.
- Step-data fields, national-code/username uniqueness, password hashing,
  video upload — Phase 3 scope.
- State machine, lazy expiration, OTP persistence, step APIs — Phases 4–6.
- PII protection decisions (retention/backup/encryption) — `DEFERRED.md`
  _051 entry, unchanged and still gating the first real write path.
