import { i18nIssueMessage } from '@nestjs/i18n';
import { z } from 'zod';

import {
  ENROLLMENT_NATIONAL_CODE_FORMAT,
  ENROLLMENT_STEP_FIELD_MAX_LENGTHS,
  ENROLLMENT_USERNAME_FORMAT,
} from '#modules/enrollments/enrollments.enums.js';

import { toJsonSchemaObject, successEnvelopeSchema } from '#swagger/openapi.schemas.js';

const IRANIAN_MOBILE_PATTERN = /^09\d{9}$/;

// Normalizes common user spellings to the national mobile format before
// validation: surrounding whitespace is trimmed, and a +98 / 0098 / 98
// country code or an omitted leading zero are folded back to the 09 prefix.
// Everything else is left untouched so validation reports it, not masks it.
//
// Exported so the idempotency scope/fingerprint (enrollments.idempotency.ts)
// reuse the exact same normalization — the idempotency interceptor runs
// before pipes and sees the raw request body (ADR-039).
export function toNationalMobile(value: string): string {
  const trimmed = value.trim();

  if (trimmed.startsWith('+98')) return `0${trimmed.slice(3)}`;
  if (trimmed.startsWith('0098')) return `0${trimmed.slice(4)}`;
  if (trimmed.startsWith('98')) return `0${trimmed.slice(2)}`;
  if (/^9\d{9}$/.test(trimmed)) return `0${trimmed}`;

  return trimmed;
}

// Shared phone normalization + validation: transforms common spellings to
// the national mobile format, then validates. Reused by every enrollment
// request carrying a phone number so the normalization rules exist once.
export const phoneNumberSchema = z
  .string()
  .transform(toNationalMobile)
  .pipe(z.string().regex(IRANIAN_MOBILE_PATTERN, i18nIssueMessage('validation.phoneNumber')));

export const challengeRequestSchema = z
  .object({
    phoneNumber: phoneNumberSchema,
  })
  .strict();

export type ChallengeRequestBody = z.infer<typeof challengeRequestSchema>;

// The OTP is validated as an exact six-character numeric string: it must not
// be coerced to a number because leading zeros are significant.
export const verifyRequestSchema = z
  .object({
    phoneNumber: phoneNumberSchema,
    otp: z.string().regex(/^\d{6}$/, i18nIssueMessage('validation.otp')),
  })
  .strict();

export type VerifyRequestBody = z.infer<typeof verifyRequestSchema>;

// Derive the Zod regex from the single-source format constants (DEFERRED _061 #1).
const nationalCodePattern = new RegExp(ENROLLMENT_NATIONAL_CODE_FORMAT);
const usernamePattern = new RegExp(ENROLLMENT_USERNAME_FORMAT);

// National Code: 10 digits (Iranian national code with checksum algorithm deferred).
export const nationalCodeStepSchema = z
  .object({
    nationalCode: z
      .string()
      .regex(nationalCodePattern, i18nIssueMessage('validation.nationalCode')),
  })
  .strict();
export type NationalCodeStepBody = z.infer<typeof nationalCodeStepSchema>;

// Full Name: firstName + lastName (each max 50 chars).
export const fullNameStepSchema = z
  .object({
    firstName: z
      .string()
      .max(ENROLLMENT_STEP_FIELD_MAX_LENGTHS.firstName, i18nIssueMessage('validation.firstName')),
    lastName: z
      .string()
      .max(ENROLLMENT_STEP_FIELD_MAX_LENGTHS.lastName, i18nIssueMessage('validation.lastName')),
  })
  .strict();
export type FullNameStepBody = z.infer<typeof fullNameStepSchema>;

// Birth Date: YYYY-MM-DD (validated as ISO date string; native `date` column in DB).
export const birthDateStepSchema = z
  .object({
    birthDate: z.string().date({ message: i18nIssueMessage('validation.birthDate') }),
  })
  .strict();
export type BirthDateStepBody = z.infer<typeof birthDateStepSchema>;

// Referral Code: optional opaque string, max 20 chars.
export const referralCodeStepSchema = z
  .object({
    referralCode: z
      .string()
      .max(
        ENROLLMENT_STEP_FIELD_MAX_LENGTHS.referralCode,
        i18nIssueMessage('validation.referralCode'),
      )
      .optional(),
  })
  .strict();
export type ReferralCodeStepBody = z.infer<typeof referralCodeStepSchema>;

// Username: alphanumeric with . _ - , 3-30 chars (case-insensitive input;
// the application normalizes to lowercase before persistence, ADR-042).
export const usernameStepSchema = z
  .object({
    username: z
      .string()
      .transform((v) => v.toLowerCase())
      .pipe(z.string().regex(usernamePattern, i18nIssueMessage('validation.username'))),
  })
  .strict();
export type UsernameStepBody = z.infer<typeof usernameStepSchema>;

// Password: client provides plaintext; service hashes before persisting.
// Minimum 8 chars, max 72 (NIST SP 800-63B), at least one letter and one digit.
export const passwordStepSchema = z
  .object({
    password: z
      .string()
      .min(8, i18nIssueMessage('validation.password.min'))
      .max(72, i18nIssueMessage('validation.password.max'))
      .regex(/^(?=.*[A-Za-z])(?=.*\d)/, i18nIssueMessage('validation.password.complexity')),
  })
  .strict();
export type PasswordStepBody = z.infer<typeof passwordStepSchema>;

// Occupation: free text, max 100 chars.
export const occupationStepSchema = z
  .object({
    occupation: z
      .string()
      .max(ENROLLMENT_STEP_FIELD_MAX_LENGTHS.occupation, i18nIssueMessage('validation.occupation')),
  })
  .strict();
export type OccupationStepBody = z.infer<typeof occupationStepSchema>;

// Video Verification: no client payload; the server records the storage reference.
// Strict empty body schema for the step that completes the form.
export const videoVerificationStepSchema = z.object({}).strict();
export type VideoVerificationStepBody = z.infer<typeof videoVerificationStepSchema>;

// ---- JSON Schema constants for Swagger documentation ----

export const challengeRequestJsonSchema = toJsonSchemaObject(challengeRequestSchema);
export const verifyRequestJsonSchema = toJsonSchemaObject(verifyRequestSchema);

export const nationalCodeStepJsonSchema = toJsonSchemaObject(nationalCodeStepSchema);
export const fullNameStepJsonSchema = toJsonSchemaObject(fullNameStepSchema);
export const birthDateStepJsonSchema = toJsonSchemaObject(birthDateStepSchema);
export const referralCodeStepJsonSchema = toJsonSchemaObject(referralCodeStepSchema);
export const usernameStepJsonSchema = toJsonSchemaObject(usernameStepSchema);
export const passwordStepJsonSchema = toJsonSchemaObject(passwordStepSchema);
export const occupationStepJsonSchema = toJsonSchemaObject(occupationStepSchema);
export const videoVerificationStepJsonSchema = toJsonSchemaObject(videoVerificationStepSchema);

export interface StepSubmissionResponse {
  publicId: string;
  status: string;
  currentStep: string;
  expiresAt: string;
}

export const stepSubmissionResponseSchema = successEnvelopeSchema({
  type: 'object',
  properties: {
    publicId: { type: 'string', format: 'uuid', example: '018f4b2e-7c0a-7d3f-a5b9-1e2c3d4f5a6b' },
    status: {
      type: 'string',
      enum: ['INITIAL', 'IN_PROGRESS', 'PENDING_REVIEW', 'REJECTED', 'APPROVED', 'EXPIRED'],
    },
    currentStep: {
      type: 'string',
      enum: [
        'NATIONAL_CODE',
        'FULL_NAME',
        'BIRTH_DATE',
        'REFERRAL_CODE',
        'USERNAME',
        'PASSWORD',
        'OCCUPATION',
        'VIDEO_VERIFICATION',
        'COMPLETED',
      ],
    },
    expiresAt: { type: 'string', format: 'date-time' },
  },
  required: ['publicId', 'status', 'currentStep', 'expiresAt'],
});
