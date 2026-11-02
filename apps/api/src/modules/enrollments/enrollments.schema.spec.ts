import { describe, expect, it } from 'vitest';
import type { ZodType, z } from 'zod';
import { challengeRequestSchema, verifyRequestSchema } from './enrollments.schema.js';

// Parses with the request schema, failing the test when the schema rejects.
function parseValid<S extends ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new Error(`Expected the schema to accept ${JSON.stringify(input)}.`);
  }
  return result.data;
}

// Expects the schema to reject the input and returns the issue messages.
function parseIssues(schema: ZodType, input: unknown): string[] {
  const result = schema.safeParse(input);
  if (result.success) {
    throw new Error(`Expected the schema to reject ${JSON.stringify(input)}.`);
  }
  return result.error.issues.map((issue) => issue.message);
}

describe('challengeRequestSchema', () => {
  it('accepts a canonical Iranian mobile number unchanged', () => {
    // Arrange
    const input = { phoneNumber: '09123456789' };

    // Act
    const result = parseValid(challengeRequestSchema, input);

    // Assert
    expect(result).toEqual(input);
  });

  it('normalizes a +98 country code to the national format', () => {
    // Arrange + Act
    const result = parseValid(challengeRequestSchema, { phoneNumber: '+989123456789' });

    // Assert
    expect(result.phoneNumber).toBe('09123456789');
  });

  it('normalizes a 0098 country code to the national format', () => {
    // Arrange + Act
    const result = parseValid(challengeRequestSchema, { phoneNumber: '00989123456789' });

    // Assert
    expect(result.phoneNumber).toBe('09123456789');
  });

  it('normalizes a bare 98 country code without the plus sign', () => {
    // Arrange + Act
    const result = parseValid(challengeRequestSchema, { phoneNumber: '989123456789' });

    // Assert
    expect(result.phoneNumber).toBe('09123456789');
  });

  it('normalizes a number with the leading zero omitted', () => {
    // Arrange + Act
    const result = parseValid(challengeRequestSchema, { phoneNumber: '9123456789' });

    // Assert
    expect(result.phoneNumber).toBe('09123456789');
  });

  it('trims surrounding whitespace before normalizing', () => {
    // Arrange + Act
    const result = parseValid(challengeRequestSchema, { phoneNumber: '  09123456789  ' });

    // Assert
    expect(result.phoneNumber).toBe('09123456789');
  });

  it('rejects landline numbers', () => {
    // Arrange + Act
    const issues = parseIssues(challengeRequestSchema, { phoneNumber: '02112345678' });

    // Assert
    expect(issues).toHaveLength(1);
  });

  it('rejects numbers that are the wrong length after normalization', () => {
    // Arrange
    const inputs = ['0912345678', '091234567890', '912345678'];

    // Act + Assert
    for (const phoneNumber of inputs) {
      expect(parseIssues(challengeRequestSchema, { phoneNumber })).toHaveLength(1);
    }
  });

  it('rejects letters, internal spaces and special characters', () => {
    // Arrange
    const inputs = ['0912abc6789', '0912 345 678', '09123456789!'];

    // Act + Assert
    for (const phoneNumber of inputs) {
      expect(parseIssues(challengeRequestSchema, { phoneNumber })).toHaveLength(1);
    }
  });

  it('rejects an empty or whitespace-only phone number', () => {
    // Arrange + Act + Assert
    expect(parseIssues(challengeRequestSchema, { phoneNumber: '' })).toHaveLength(1);
    expect(parseIssues(challengeRequestSchema, { phoneNumber: '   ' })).toHaveLength(1);
  });

  it('rejects a missing or non-string phone number', () => {
    // Arrange + Act + Assert
    expect(parseIssues(challengeRequestSchema, {})).toHaveLength(1);
    expect(parseIssues(challengeRequestSchema, { phoneNumber: 9123456789 })).toHaveLength(1);
  });

  it('reports a meaningful issue for an invalid phone number', () => {
    // Arrange + Act
    const issues = parseIssues(challengeRequestSchema, { phoneNumber: '0912345678' });

    // Assert
    expect(issues[0]).toContain('09XXXXXXXXX');
  });
});

describe('verifyRequestSchema', () => {
  it('accepts a canonical phone number and six-digit OTP unchanged', () => {
    // Arrange
    const input = { phoneNumber: '09123456789', otp: '048391' };

    // Act
    const result = parseValid(verifyRequestSchema, input);

    // Assert
    expect(result).toEqual(input);
  });

  it('normalizes the phone number and preserves the OTP verbatim', () => {
    // Arrange & Act
    const result = parseValid(verifyRequestSchema, {
      phoneNumber: '+989123456789',
      otp: '000001',
    });

    // Assert
    expect(result.phoneNumber).toBe('09123456789');
    expect(result.otp).toBe('000001');
  });

  it('rejects OTPs that are not an exact six-digit numeric string', () => {
    // Arrange
    const invalidOtps = ['48391', '4839211', '48392a', '48 3921', '', 483_921];

    // Act + Assert
    for (const otp of invalidOtps) {
      expect(parseIssues(verifyRequestSchema, { phoneNumber: '09123456789', otp })).toHaveLength(1);
    }
  });

  it('rejects an invalid phone number', () => {
    // Arrange & Act
    const issues = parseIssues(verifyRequestSchema, { phoneNumber: '02112345678', otp: '483921' });

    // Assert
    expect(issues).toHaveLength(1);
  });

  it('rejects missing fields', () => {
    // Arrange & Act
    const missingPhone = parseIssues(verifyRequestSchema, { otp: '483921' });
    const missingOtp = parseIssues(verifyRequestSchema, { phoneNumber: '09123456789' });

    // Assert
    expect(missingPhone).toHaveLength(1);
    expect(missingOtp).toHaveLength(1);
  });
});
