import { z } from 'zod';

const IRANIAN_MOBILE_PATTERN = /^09\d{9}$/;
const IRANIAN_MOBILE_MESSAGE =
  'Phone number must be an Iranian mobile number in the format 09XXXXXXXXX.';

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

export const challengeRequestSchema = z.object({
  phoneNumber: z
    .string()
    .transform(toNationalMobile)
    .pipe(z.string().regex(IRANIAN_MOBILE_PATTERN, IRANIAN_MOBILE_MESSAGE)),
});

export type ChallengeRequestBody = z.infer<typeof challengeRequestSchema>;
