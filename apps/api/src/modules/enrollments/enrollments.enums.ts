/**
 * Enrollment lifecycle vocabulary (ADR-041): the single source of the
 * persisted status/step values. Stored values equal their identifiers, and
 * the database CHECK constraints are composed from these arrays — no value
 * list is ever duplicated. Order is significant for `ENROLLMENT_STEPS`: it
 * encodes the onboarding form sequence (master prompt §7.4).
 */

export const ENROLLMENT_STATUSES = [
  'INITIAL',
  'IN_PROGRESS',
  'PENDING_REVIEW',
  'REJECTED',
  'APPROVED',
  'EXPIRED',
] as const;

export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

/** The only statuses that can expire (master prompt §7.3). */
export const EXPIRABLE_ENROLLMENT_STATUSES = [
  'INITIAL',
  'IN_PROGRESS',
] as const satisfies readonly EnrollmentStatus[];

export const ENROLLMENT_STEPS = [
  'NATIONAL_CODE',
  'FULL_NAME',
  'BIRTH_DATE',
  'REFERRAL_CODE',
  'USERNAME',
  'PASSWORD',
  'OCCUPATION',
  'VIDEO_VERIFICATION',
  'COMPLETED',
] as const;

export type EnrollmentStep = (typeof ENROLLMENT_STEPS)[number];

/** A new Enrollment starts here (column default). */
export const ENROLLMENT_INITIAL_STATUS: EnrollmentStatus = 'INITIAL';
export const ENROLLMENT_INITIAL_STEP: EnrollmentStep = 'NATIONAL_CODE';

/** The only status that releases the phone number (ADR-041). */
export const ENROLLMENT_STATUS_EXPIRED: EnrollmentStatus = 'EXPIRED';

/** Fixed Enrollment lifetime (master prompt §3.2): creation instant + 24 hours. */
export const ENROLLMENT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Schema constraint/index identifiers (ADR-041). Single source: the entity
 * decorators and both verification specs reference these constants; the
 * applied migration carries identical literals — migrations are immutable
 * and are never regenerated from these constants (ADR-033).
 */
export const ENROLLMENT_SCHEMA_CONSTRAINT_NAMES = {
  phoneNumberFormat: 'enrollments_phone_number_format',
  publicIdUuidv7: 'enrollments_public_id_uuidv7',
  statusValid: 'enrollments_status_valid',
  currentStepValid: 'enrollments_current_step_valid',
  phoneActiveUnique: 'enrollments_phone_active_unique',
  publicIdUnique: 'enrollments_public_id_unique',
} as const;
