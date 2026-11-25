import { Check, Entity, Property, Unique } from '@mikro-orm/decorators/legacy';
import { OptionalProps } from '@mikro-orm/core';
import type { Opt } from '@mikro-orm/core';

import { BaseEntity } from '#database/base.entity.js';
import {
  ENROLLMENT_INITIAL_STATUS,
  ENROLLMENT_INITIAL_STEP,
  ENROLLMENT_NATIONAL_CODE_FORMAT,
  ENROLLMENT_PHONE_NUMBER_FORMAT,
  ENROLLMENT_SCHEMA_CONSTRAINT_NAMES,
  ENROLLMENT_STATUS_EXPIRED,
  ENROLLMENT_STATUSES,
  ENROLLMENT_STEP_FIELD_MAX_LENGTHS,
  ENROLLMENT_STEPS,
  ENROLLMENT_TTL_MS,
  ENROLLMENT_USERNAME_FORMAT,
  PASSWORD_HASH_MAX_LENGTH,
} from '#modules/enrollments/enrollments.enums.js';
import type { EnrollmentStatus, EnrollmentStep } from '#modules/enrollments/enrollments.enums.js';

/** Renders a SQL `in (...)` value list from the single-source enums (ADR-041). */
const checkValues = (values: readonly string[]): string =>
  values.map((value) => `'${value}'`).join(', ');

/** Renders a SQL length CHECK for a prose column (ADR-042). */
const lengthCheck = (column: string, max: number): string => `char_length(${column}) <= ${max}`;

/**
 * A customer's onboarding application (ADR-041/042) — not an active bank
 * account and not an authenticated banking identity. Carries the inherited
 * `BaseEntity` columns (ADR-029), the Enrollment core lifecycle fields, and
 * the step-data fields. The class-level checks and the partial unique
 * indexes mirror the approved field-constraint matrices; the database is
 * the final enforcement boundary for every invariant.
 */
@Entity({ tableName: 'enrollments' })
@Check({
  name: ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.phoneNumberFormat,
  expression: `phone_number ~ '${ENROLLMENT_PHONE_NUMBER_FORMAT}'`,
})
@Check({
  name: ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.publicIdUuidv7,
  expression: 'uuid_extract_version(public_id) = 7',
})
@Check({
  name: ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.statusValid,
  expression: `status in (${checkValues(ENROLLMENT_STATUSES)})`,
})
@Check({
  name: ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.currentStepValid,
  expression: `current_step in (${checkValues(ENROLLMENT_STEPS)})`,
})
@Check({
  name: ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.nationalCodeFormat,
  expression: `national_code ~ '${ENROLLMENT_NATIONAL_CODE_FORMAT}'`,
})
@Check({
  name: ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.usernameFormat,
  expression: `username ~ '${ENROLLMENT_USERNAME_FORMAT}'`,
})
@Check({
  name: ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.firstNameLength,
  expression: lengthCheck('first_name', ENROLLMENT_STEP_FIELD_MAX_LENGTHS.firstName),
})
@Check({
  name: ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.lastNameLength,
  expression: lengthCheck('last_name', ENROLLMENT_STEP_FIELD_MAX_LENGTHS.lastName),
})
@Check({
  name: ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.referralCodeLength,
  expression: lengthCheck('referral_code', ENROLLMENT_STEP_FIELD_MAX_LENGTHS.referralCode),
})
@Check({
  name: ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.occupationLength,
  expression: lengthCheck('occupation', ENROLLMENT_STEP_FIELD_MAX_LENGTHS.occupation),
})
@Check({
  name: ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.videoKeyLength,
  expression: lengthCheck('video_key', ENROLLMENT_STEP_FIELD_MAX_LENGTHS.videoKey),
})
@Check({
  name: ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.passwordHashLength,
  expression: lengthCheck('password_hash', PASSWORD_HASH_MAX_LENGTH),
})
@Unique({
  name: ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.phoneActiveUnique,
  properties: ['phoneNumber'],
  // The one-active-per-phone invariant (ADR-041): the predicate references
  // only persisted lifecycle status — never now() or expires_at.
  where: `status <> '${ENROLLMENT_STATUS_EXPIRED}'`,
})
@Unique({
  name: ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.publicIdUnique,
  properties: ['publicId'],
})
@Unique({
  name: ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.nationalCodeActiveUnique,
  properties: ['nationalCode'],
  // Identifier release (ADR-042): an expired enrollment frees its national
  // code exactly as it frees its phone number; the other non-expired
  // statuses keep occupying it.
  where: `national_code IS NOT NULL AND status <> '${ENROLLMENT_STATUS_EXPIRED}'`,
})
@Unique({
  name: ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.usernameActiveUnique,
  properties: ['username'],
  // Identifier release (ADR-042): same semantics as the national code.
  where: `username IS NOT NULL AND status <> '${ENROLLMENT_STATUS_EXPIRED}'`,
})
export class Enrollment extends BaseEntity {
  /**
   * Create-time-optional fields (MikroORM `em.create` typing): the
   * application never supplies `publicId` (database-generated, read back
   * after insert) or `expiresAt` (derived from the creation instant by the
   * initializer below).
   */
  [OptionalProps]?: 'publicId' | 'expiresAt';

  /**
   * Canonical national mobile format (`09XXXXXXXXX`, ADR-041) — the single
   * stored representation; every accepted request spelling is normalized to
   * this shape (`toNationalMobile`) before persistence. An identity column,
   * never a client-visible identifier and never proof of authorization.
   */
  @Property({ columnType: 'varchar(11)' })
  phoneNumber!: string;

  /**
   * The only client-visible Enrollment identifier: PostgreSQL `uuid` with
   * the native `uuidv7()` default (ADR-040/041). The application never
   * supplies it — the database generates the value and the driver reads it
   * back after insert. An identifier, never proof of authorization.
   */
  @Property({ columnType: 'uuid', defaultRaw: 'uuidv7()' })
  publicId!: string;

  /**
   * Persisted lifecycle status (ADR-041): `INITIAL` on creation; the value
   * list and default come from the single-source enums.
   */
  @Property({ columnType: 'text', default: ENROLLMENT_INITIAL_STATUS })
  status: Opt<EnrollmentStatus> = ENROLLMENT_INITIAL_STATUS;

  /**
   * Ordered onboarding form marker (ADR-041): `NATIONAL_CODE` on creation;
   * only the state machine (Phase 4) advances it.
   */
  @Property({ columnType: 'text', default: ENROLLMENT_INITIAL_STEP })
  currentStep: Opt<EnrollmentStep> = ENROLLMENT_INITIAL_STEP;

  /**
   * Fixed expiration instant: `createdAt` + 24 hours, never extended
   * (master prompt §3.2). Set from the same clock reading that produced the
   * inherited `createdAt` — parent class fields initialize before subclass
   * fields — so no database `now()` default exists (one-clock-reading rule,
   * ADR-041). The creation path must never accept or forward `createdAt` or
   * `expiresAt` from outside: hydration assigns provided values after the
   * constructor ran, which would silently break the 24-hour invariant.
   */
  @Property({ columnType: 'timestamptz(3)' })
  expiresAt: Date = new Date(this.createdAt.getTime() + ENROLLMENT_TTL_MS);

  /**
   * Iranian national code (کد ملی, ADR-042): canonical 10-digit storage
   * with a format CHECK; the checksum algorithm validates at the
   * application layer (Phase 6). Sensitive plaintext PII — the retention/
   * backup/encryption decisions stay open in `DEFERRED.md` (_051) until the
   * first write path. Released when the enrollment expires.
   */
  @Property({ columnType: 'varchar(10)' })
  nationalCode: Opt<string> | null = null;

  /**
   * Given name (ADR-042): prose with an explicit length contract.
   */
  @Property({ columnType: 'text' })
  firstName: Opt<string> | null = null;

  /**
   * Family name (ADR-042): prose with an explicit length contract.
   */
  @Property({ columnType: 'text' })
  lastName: Opt<string> | null = null;

  /**
   * Birth date (ADR-042): PostgreSQL `date` — native validity, application
   * representation `YYYY-MM-DD`.
   */
  @Property({ type: 'date' })
  birthDate: Opt<string> | null = null;

  /**
   * Referral code (ADR-042): opaque string with an explicit length
   * contract; the referral-provider integration is deferred, so no format
   * CHECK is speculated.
   */
  @Property({ columnType: 'text' })
  referralCode: Opt<string> | null = null;

  /**
   * Username (ADR-042): stored lowercase-normalized — the application
   * normalizes to lowercase before persisting (Phase 6); mixed-case input
   * is rejected by the CHECK rather than silently folded. Released when the
   * enrollment expires.
   */
  @Property({ columnType: 'text' })
  username: Opt<string> | null = null;

  /**
   * Password hash (ADR-042): application-generated only (the hashing
   * implementation belongs to the Phase 6 PASSWORD step); never receives
   * unvalidated client input, so no length cap is speculated. Plaintext
   * passwords are never stored.
   */
  @Property({ columnType: 'text' })
  passwordHash: Opt<string> | null = null;

  /**
   * Occupation (ADR-042): free text per developer decision — no controlled
   * enumeration until the review workflow defines categories.
   */
  @Property({ columnType: 'text' })
  occupation: Opt<string> | null = null;

  /**
   * Video verification storage reference (ADR-042): a controlled storage
   * key, not an arbitrary client-provided URL; the upload integration is
   * deferred, so only the length contract applies.
   */
  @Property({ columnType: 'text' })
  videoKey: Opt<string> | null = null;
}
