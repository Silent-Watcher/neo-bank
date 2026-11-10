import { i18nIssueMessage } from '@nestjs/i18n';
import { z } from 'zod';

const IRANIAN_MOBILE_PATTERN = /^09\d{9}$/;

// Normalizes common user spellings to the national mobile format before
// validation: surrounding whitespace is trimmed, and a +98 / 0098 / 98
// country code or an omitted leading zero are folded back to the 09 prefix.
// Everything else is left untouched so validation reports it, not masks it.
function toNationalMobile(value: string): string {
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

export const challengeRequestSchema = z.object({
  phoneNumber: phoneNumberSchema,
});

export type ChallengeRequestBody = z.infer<typeof challengeRequestSchema>;

// The OTP is validated as an exact six-character numeric string: it must not
// be coerced to a number because leading zeros are significant.
export const verifyRequestSchema = z.object({
  phoneNumber: phoneNumberSchema,
  otp: z.string().regex(/^\d{6}$/, i18nIssueMessage('validation.otp')),
});

export type VerifyRequestBody = z.infer<typeof verifyRequestSchema>;
