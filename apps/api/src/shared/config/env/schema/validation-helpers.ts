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
