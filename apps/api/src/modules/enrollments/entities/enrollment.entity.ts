import { Check, Entity, Property, Unique } from '@mikro-orm/decorators/legacy';
import { OptionalProps } from '@mikro-orm/core';
import type { Opt } from '@mikro-orm/core';

import { BaseEntity } from '#database/base.entity.js';
import {
  ENROLLMENT_INITIAL_STATUS,
  ENROLLMENT_INITIAL_STEP,
  ENROLLMENT_SCHEMA_CONSTRAINT_NAMES,
  ENROLLMENT_STATUS_EXPIRED,
  ENROLLMENT_STATUSES,
  ENROLLMENT_STEPS,
  ENROLLMENT_TTL_MS,
} from '#modules/enrollments/enrollments.enums.js';
import type { EnrollmentStatus, EnrollmentStep } from '#modules/enrollments/enrollments.enums.js';

/** Renders a SQL `in (...)` value list from the single-source enums (ADR-041). */
const checkValues = (values: readonly string[]): string =>
  values.map((value) => `'${value}'`).join(', ');

/**
 * A customer's onboarding application (ADR-041) — not an active bank account
 * and not an authenticated banking identity. Carries the inherited
 * `BaseEntity` columns (ADR-029) and adds the Enrollment core lifecycle
 * fields. The class-level checks and the partial unique index mirror the
 * approved field-constraint matrix; the database is the final enforcement
 * boundary for every invariant.
 */
@Entity({ tableName: 'enrollments' })
@Check({
  name: ENROLLMENT_SCHEMA_CONSTRAINT_NAMES.phoneNumberFormat,
  expression: "phone_number ~ '^09[0-9]{9}$'",
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
}
