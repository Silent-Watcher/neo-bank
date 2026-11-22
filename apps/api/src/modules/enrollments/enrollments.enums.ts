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

/** The first submitted step moves the enrollment into the working state. */
export const ENROLLMENT_STATUS_IN_PROGRESS: EnrollmentStatus = 'IN_PROGRESS';
/** Completing VIDEO_VERIFICATION moves the enrollment into review. */
export const ENROLLMENT_STATUS_PENDING_REVIEW: EnrollmentStatus = 'PENDING_REVIEW';

/** The last form step; completing it moves the enrollment to review. */
export const ENROLLMENT_STEP_VIDEO_VERIFICATION: EnrollmentStep = 'VIDEO_VERIFICATION';
/** Completion marker (master prompt §7.4) — never a client-submittable step. */
export const ENROLLMENT_STEP_COMPLETED: EnrollmentStep = 'COMPLETED';

/** The only status that releases the phone number (ADR-041). */
export const ENROLLMENT_STATUS_EXPIRED: EnrollmentStatus = 'EXPIRED';

/** Fixed Enrollment lifetime (master prompt §3.2): creation instant + 24 hours. */
export const ENROLLMENT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Schema constraint/index identifiers (ADR-041/042). Single source: the
 * entity decorators and both verification specs reference these constants;
 * the applied migrations carry identical literals — migrations are immutable
 * and are never regenerated from these constants (ADR-033).
 */
export const ENROLLMENT_SCHEMA_CONSTRAINT_NAMES = {
  phoneNumberFormat: 'enrollments_phone_number_format',
  publicIdUuidv7: 'enrollments_public_id_uuidv7',
  statusValid: 'enrollments_status_valid',
  currentStepValid: 'enrollments_current_step_valid',
  phoneActiveUnique: 'enrollments_phone_active_unique',
  publicIdUnique: 'enrollments_public_id_unique',
  nationalCodeFormat: 'enrollments_national_code_format',
  usernameFormat: 'enrollments_username_format',
  firstNameLength: 'enrollments_first_name_length',
  lastNameLength: 'enrollments_last_name_length',
  referralCodeLength: 'enrollments_referral_code_length',
  occupationLength: 'enrollments_occupation_length',
  videoKeyLength: 'enrollments_video_key_length',
  nationalCodeActiveUnique: 'enrollments_national_code_active_unique',
  usernameActiveUnique: 'enrollments_username_active_unique',
} as const;

/**
 * Stored format contracts (ADR-042): the SQL CHECK expressions compose from
 * these strings and the application validators (Phase 6 step submission)
 * derive their patterns from the same source. The pre-existing Zod phone
 * pattern (`enrollments.schema.ts`) converges onto
 * `ENROLLMENT_PHONE_NUMBER_FORMAT` in Phase 6 (DEFERRED _061 entry 1); until
 * then it is the one known duplicate.
 */
export const ENROLLMENT_NATIONAL_CODE_FORMAT = '^[0-9]{10}$';
export const ENROLLMENT_USERNAME_FORMAT = '^[a-z0-9._-]{3,30}$';
export const ENROLLMENT_PHONE_NUMBER_FORMAT = '^09[0-9]{9}$';

/**
 * Prose-field length contracts (ADR-042, master prompt §7.5): consumed by
 * the entity CHECK composition and the Phase 6 Zod schemas.
 */
export const ENROLLMENT_STEP_FIELD_MAX_LENGTHS = {
  firstName: 50,
  lastName: 50,
  referralCode: 20,
  occupation: 100,
  videoKey: 500,
} as const;
