import { describe, expect, it } from 'vitest';

import {
  composeOtpChallengeValue,
  computeOtpDigest,
  otpDigestMatches,
  parseOtpChallengeValue,
} from './enrollments.otp-digest.js';

const SECRET = '1111111111111111111111111111111111111111111111111111111111111111';
const OTHER_SECRET = 'ab'.repeat(32);
const PHONE = '09123456789';
const OTP = '483921';

// Independent known-answer vector produced with the OpenSSL CLI
// (`openssl dgst -sha256 -mac HMAC -macopt hexkey:<secret>` over
// "09123456789:483921"), so the expectation does not reuse the
// implementation's own construction.
const KNOWN_ANSWER_DIGEST = 'd65e1e36cd02f0035ea12819cdaf10f7e9bad9e61460f7473d4fbb8b376659e5';

describe('computeOtpDigest', () => {
  it('produces the independently verified known-answer digest for the same phone, OTP, and secret', () => {
    // Arrange & Act
    const digest = computeOtpDigest(PHONE, OTP, SECRET);

    // Assert
    expect(digest).toBe(KNOWN_ANSWER_DIGEST);
  });

  it('produces the same digest for the same phone, OTP, and secret', () => {
    // Arrange & Act
    const first = computeOtpDigest(PHONE, OTP, SECRET);
    const second = computeOtpDigest(PHONE, OTP, SECRET);

    // Assert
    expect(first).toBe(second);
  });

  it('produces different digests for different OTP values', () => {
    // Arrange & Act
    const first = computeOtpDigest(PHONE, '483921', SECRET);
    const second = computeOtpDigest(PHONE, '483922', SECRET);

    // Assert
    expect(first).not.toBe(second);
  });

  it('produces different digests for different secrets', () => {
    // Arrange & Act
    const first = computeOtpDigest(PHONE, OTP, SECRET);
    const second = computeOtpDigest(PHONE, OTP, OTHER_SECRET);

    // Assert
    expect(first).not.toBe(second);
  });

  it('produces different digests for different phone numbers (challenge context binding)', () => {
    // Arrange & Act
    const first = computeOtpDigest('09123456789', OTP, SECRET);
    const second = computeOtpDigest('09987654321', OTP, SECRET);

    // Assert
    expect(first).not.toBe(second);
  });

  it('returns a 64-character lowercase hex digest that never contains the plaintext OTP', () => {
    // Arrange & Act
    const digest = computeOtpDigest(PHONE, OTP, SECRET);

    // Assert
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain(OTP);
    expect(digest).not.toContain(PHONE);
  });
});

describe('otpDigestMatches', () => {
  it('matches a correctly computed digest against itself', () => {
    // Arrange
    const digest = computeOtpDigest(PHONE, OTP, SECRET);

    // Act & Assert
    expect(otpDigestMatches(digest, digest)).toBe(true);
  });

  it('does not match a digest computed from a different OTP', () => {
    // Arrange
    const stored = computeOtpDigest(PHONE, OTP, SECRET);
    const submitted = computeOtpDigest(PHONE, '999999', SECRET);

    // Act & Assert
    expect(otpDigestMatches(submitted, stored)).toBe(false);
  });
});

describe('composeOtpChallengeValue / parseOtpChallengeValue', () => {
  const CHALLENGE_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

  it('round-trips a composed challenge value', () => {
    // Arrange
    const digest = computeOtpDigest(PHONE, OTP, SECRET);
    const value = composeOtpChallengeValue(CHALLENGE_ID, digest);

    // Act
    const parsed = parseOtpChallengeValue(value);

    // Assert
    expect(parsed).toEqual({ challengeId: CHALLENGE_ID, digest });
  });

  it('returns null for a missing stored value', () => {
    // Arrange & Act & Assert
    expect(parseOtpChallengeValue(null)).toBeNull();
  });

  it.each([
    ['malformed garbage', 'not-a-challenge-value'],
    ['bare digest without a challenge ID', 'ab'.repeat(32)],
    ['non-UUID challenge ID', `zzzz:${'ab'.repeat(32)}`],
    ['non-hex digest', `${CHALLENGE_ID}:${'g'.repeat(64)}`],
    ['short digest', `${CHALLENGE_ID}:${'ab'.repeat(31)}`],
    ['empty string', ''],
  ])('returns null for a malformed stored value (%s) without throwing', (_description, value) => {
    // Arrange & Act & Assert
    expect(parseOtpChallengeValue(value)).toBeNull();
  });
});
