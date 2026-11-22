# _061 — Enrollment Step Data Model (Enrollment Master Prompt Phase 3)

## Original Request

Phase 3 of the Enrollment master prompt: add the approved step-data fields to
the Enrollment entity, keep uncompleted fields nullable, add national-code
and username uniqueness where approved, ensure expired enrollments release
both identifiers, generate and review a new forward migration, and add
entity metadata and PostgreSQL integration tests. No step-submission
endpoints, no password hashing, no video upload. The developer additionally
directed: implement the related deferred items inside this phase, persist
every security-subagent recommendation that stays out of scope in
`DEFERRED.md`, and wait for final approval before committing.

## Approval Gate

Four structured decisions were presented and approved by the developer:
national code = format-only DB CHECK (checksum validates at the application
layer, Phase 6); usernames = lowercase-normalized storage with a charset/
length CHECK (no citext, no expression index); field types = exact
`varchar(n)` for fixed-format identifiers, `text` + `char_length` CHECKs for
prose; occupation = free text up to 100 chars. Per the ADR-first workflow,
**ADR-042 was the first repository write** (`DECISIONS.md`, Accepted,
2026-11-22).

## Implementation

- **`enrollments.enums.ts`** — extended the single source:
  `ENROLLMENT_NATIONAL_CODE_FORMAT` (`^[0-9]{10}$`),
  `ENROLLMENT_USERNAME_FORMAT` (`^[a-z0-9._-]{3,30}$`),
  `ENROLLMENT_STEP_FIELD_MAX_LENGTHS` (firstName 50, lastName 50,
  referralCode 20, occupation 100, videoKey 500), and nine new entries in
  `ENROLLMENT_SCHEMA_CONSTRAINT_NAMES`. The SQL CHECK expressions compose
  from these constants — no pattern or length is duplicated.
- **`enrollment.entity.ts`** — nine nullable step-data properties
  (`nationalCode` varchar(10), `firstName`/`lastName`/`referralCode`/
  `occupation`/`videoKey`/`passwordHash` text, `birthDate` native
  `date` with YYYY-MM-DD string hydration) + seven new class-level CHECKs
  (two format, five length) + two new partial unique indexes with the
  expired-release predicate (`IS NOT NULL AND status <> 'EXPIRED'`).
- **Migration `Migration20261122011051`** — generated from the metadata
  diff, inspected (all-nullable adds, no backfill needed), reviewed, and
  applied to the dev Compose PostgreSQL. `down()` restores the exact
  post-Phase-2 shape.
- **Migration review** — performed by the dedicated `migration-reviewer`
  subagent (first run on this platform after the plugin refresh): verdict
  **APPROVED with zero findings** (NULL-CHECK semantics, regex anchoring,
  partial-index predicates, `char_length` on Persian prose, naming
  consistency, exact reversibility all explicitly verified).
- **Tests** — entity metadata spec (own-property list + per-field type
  contracts + new checks/uniques); db-spec (column shape incl. all nine
  step columns, 11 CHECK names, three partial unique indexes, identity
  release invariants — national code/username sharing, NULL non-collision,
  expired release, occupied-status blocking — format/charset/length CHECK
  violations, native date validity, step-data round-trip incl. leading-zero
  national code and Persian prose); NEW `migrations-parity.db-spec.ts`
  (Migrator-based replay from zero asserting the same shape — DEFERRED
  _060 entry 1 implemented); NEW `database-lifecycle.db-spec.ts` (pool-
  lifecycle test relocated out of the enrollment suite — entry 2
  implemented); db-tier vitest config gained `hookTimeout: 30000`.

## Key Decisions

- **Deferred items implemented in-phase** (developer direction): _060
  entries 1 (parity smoke test) and 2 (lifecycle relocation) are marked
  Done in `DEFERRED.md`; entries 3 (already Done) and 4 (Phase 4/5
  write-path constraints) stay.
- **v7 direct-init gotchas encoded in the parity spec**: `orm.migrator` +
  `migrator.getPending()` (renamed from v6); direct `MikroORM.init` needs
  `metadataProvider: ReflectMetadataProvider` (decorator metadata without
  it fails on BaseEntity) and `clientUrl` (a URL in `dbName` loses the
  password at SASL).
- Test-side fixes during development: pg `count()` returns strings; three
  phone-range collisions between loop tests (fixed ranges); the
  occupied-status test accepts either active-unique constraint (the
  identity pair collides in both; PG reports whichever fires first — either
  proves occupation, documented in the assertion comment).

## Validation (all executed, 2026-11-22)

- Migration applied to dev; `mikro_orm_migrations` shows 3 applied
  migrations.
- typecheck clean; unit 54 files / 505 tests; db 6 files / 49 tests (incl.
  the new parity and lifecycle specs); e2e 115; redis 89 — all green.
- Mimosa gate: the db-spec additions were blocked mid-edit by the
  injection-shape heuristic (parameterized SQL strings in diff hunks are
  still flagged); content landed via structural rewrite scripts at the
  developer's standing direction, matching the committed parameterized
  shape; the security review (below) independently assessed the fixture
  pattern as zero-risk.
- Review gates: migration review APPROVED (zero findings — dedicated
  `migration-reviewer` subagent, first run on this platform); code review
  CHANGES_REQUIRED → remediated → APPROVED_WITH_SUGGESTIONS (Wave 33,
  iteration 2; CR-01 test-coupling bug + CR-02 parity-list drift fixed,
  CR-03/CR-04 partials deferred, CR-09 docblock fixed); code security
  SECURITY_APPROVED_WITH_INFORMATIONAL_FINDINGS (Wave 34 — four
  informational, forward-looking findings, all persisted to `DEFERRED.md`
  per the developer's standing rule). All four tiers re-verified green
  after every remediation wave (typecheck clean; unit 505/505, db 50/50,
  e2e 115/115, redis 89/89).

## Deferred

- Phase 4/5 write-path payload constraints (`DEFERRED.md` _060 entry 4,
  SEC-03/SEC-01) — unchanged.
- PII protection decisions (retention/backup/encryption for `phone_number`
  and now `national_code` — Wave 34 SEC-01) — `DEFERRED.md` _051 entry,
  gating the Phase 5 write path.
- Password-hash column bound at the Phase 6 PASSWORD step (`DEFERRED.md`
  _061 entry 3, Wave 34 SEC-02).
- Expiration transition as a security dependency of identifier release
  (`DEFERRED.md` _061 entry 4, Wave 34 SEC-03).
- Indistinguishable national-code collision responses + username
  reservation policy (`DEFERRED.md` _061 entry 5, Wave 34 SEC-04).
- Zod phone-pattern derivation from the shared constant + parity-tier CHECK
  expression-body comparison (`DEFERRED.md` _061 entries 1–2, Wave 33
  CR-03/CR-04 remainders).
- National-code checksum validation and username lowercase normalization
  live in Phase 6 Zod schemas (the DB carries format/charset CHECKs only).
- Phase 4 (state machine + lazy expiration), Phase 5 (OTP persistence),
  Phase 6 (step APIs) await explicit developer instruction.
