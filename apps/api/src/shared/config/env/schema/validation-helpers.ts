import { z } from 'zod';

/**
 * Creates a Zod schema that validates a positive integer within the JavaScript
 * safe integer range (Number.MAX_SAFE_INTEGER = 2^53 - 1).
 *
 * This ensures:
 * - The value is a valid number (coerced from string)
 * - The value is an integer (no decimals)
 * - The value is positive (> 0)
 * - The value does not exceed Number.MAX_SAFE_INTEGER, preventing overflow
 *   in millisecond conversions and other arithmetic operations.
 *
 * @param field - The field name used in error messages
 * @returns A Zod schema for a positive safe integer
 */
export function positiveSafeInteger(field: string) {
  return z.coerce
    .number({ error: `${field} must be a valid number.` })
    .int(`${field} must be an integer.`)
    .positive(`${field} must be positive.`)
    .refine((value) => Number.isSafeInteger(value), {
      message: `${field} must be within the safe integer range.`,
    });
}

/**
 * Creates a Zod schema for an optional http(s) URL environment variable used
 * for startup-log visibility (e.g. Redis Insight, MockServer addresses).
 *
 * This ensures:
 * - Blank values are treated as unset, so an empty entry in an env file
 *   behaves exactly like a missing variable.
 * - Only http(s) URLs are accepted.
 * - URLs containing credentials are rejected, so no secret can reach the
 *   startup log.
 *
 * @param field - The variable name used in error messages
 * @returns A Zod schema producing `string | undefined`
 */
export function optionalHttpUrlEnv(field: string) {
  return z
    .string()
    .transform((value) => {
      const trimmed = value.trim();
      return trimmed === '' ? undefined : trimmed;
    })
    .pipe(
      z.url({ protocol: /^https?$/, error: `${field} must be a valid http(s) URL.` }).optional(),
    )
    .refine(
      (url) => {
        if (url === undefined) return true;
        const parsed = new URL(url);
        return parsed.username === '' && parsed.password === '';
      },
      { error: `${field} must not contain credentials.` },
    )
    .optional();
}
