import { describe, expect, it } from 'vitest';
import { requestOtpSchema } from './enrollments.schema.js';

// Parses with the request schema, failing the test when the schema rejects.
function parseValid(input: unknown): { phoneNumber: string } {
  const result = requestOtpSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Expected the schema to accept ${JSON.stringify(input)}.`);
  }
  return result.data;
}

// Expects the schema to reject the input and returns the issue messages.
function parseIssues(input: unknown): string[] {
  const result = requestOtpSchema.safeParse(input);
  if (result.success) {
    throw new Error(`Expected the schema to reject ${JSON.stringify(input)}.`);
  }
  return result.error.issues.map((issue) => issue.message);
}

describe('requestOtpSchema', () => {
  it('accepts a canonical Iranian mobile number unchanged', () => {
    // Arrange
    const input = { phoneNumber: '09123456789' };

    // Act
    const result = parseValid(input);

    // Assert
    expect(result).toEqual(input);
  });

  it('normalizes a +98 country code to the national format', () => {
    // Arrange + Act
    const result = parseValid({ phoneNumber: '+989123456789' });

    // Assert
    expect(result.phoneNumber).toBe('09123456789');
  });

  it('normalizes a 0098 country code to the national format', () => {
    // Arrange + Act
    const result = parseValid({ phoneNumber: '00989123456789' });

    // Assert
    expect(result.phoneNumber).toBe('09123456789');
  });

  it('normalizes a bare 98 country code without the plus sign', () => {
    // Arrange + Act
    const result = parseValid({ phoneNumber: '989123456789' });

    // Assert
    expect(result.phoneNumber).toBe('09123456789');
  });

  it('normalizes a number with the leading zero omitted', () => {
    // Arrange + Act
    const result = parseValid({ phoneNumber: '9123456789' });

    // Assert
    expect(result.phoneNumber).toBe('09123456789');
  });

  it('trims surrounding whitespace before normalizing', () => {
    // Arrange + Act
    const result = parseValid({ phoneNumber: '  09123456789  ' });

    // Assert
    expect(result.phoneNumber).toBe('09123456789');
  });

  it('rejects landline numbers', () => {
    // Arrange + Act
    const issues = parseIssues({ phoneNumber: '02112345678' });

    // Assert
    expect(issues).toHaveLength(1);
  });

  it('rejects numbers that are the wrong length after normalization', () => {
    // Arrange
    const inputs = ['0912345678', '091234567890', '912345678'];

    // Act + Assert
    for (const phoneNumber of inputs) {
      expect(parseIssues({ phoneNumber })).toHaveLength(1);
    }
  });

  it('rejects letters, internal spaces and special characters', () => {
    // Arrange
    const inputs = ['0912abc6789', '0912 345 678', '09123456789!'];

    // Act + Assert
    for (const phoneNumber of inputs) {
      expect(parseIssues({ phoneNumber })).toHaveLength(1);
    }
  });

  it('rejects an empty or whitespace-only phone number', () => {
    // Arrange + Act + Assert
    expect(parseIssues({ phoneNumber: '' })).toHaveLength(1);
    expect(parseIssues({ phoneNumber: '   ' })).toHaveLength(1);
  });

  it('rejects a missing or non-string phone number', () => {
    // Arrange + Act + Assert
    expect(parseIssues({})).toHaveLength(1);
    expect(parseIssues({ phoneNumber: 9123456789 })).toHaveLength(1);
  });

  it('reports a meaningful issue for an invalid phone number', () => {
    // Arrange + Act
    const issues = parseIssues({ phoneNumber: '0912345678' });

    // Assert
    expect(issues[0]).toContain('09XXXXXXXXX');
  });
});
