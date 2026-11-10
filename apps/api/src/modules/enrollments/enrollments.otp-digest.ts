import { createHmac, timingSafeEqual } from 'node:crypto';

// The phone number is validated as digits-only (`09XXXXXXXXX`) by the request
// schema, so `:` cannot appear in either input part and is an unambiguous
// separator. Binding the phone into the HMAC input prevents digest
// substitution between challenges (e.g. copying a digest from one OTP key to
// another in Redis).
export function computeOtpDigest(phoneNumber: string, otp: string, secret: string): string {
  const key = Buffer.from(secret, 'hex');
  return createHmac('sha256', key).update(`${phoneNumber}:${otp}`).digest('hex');
}

/**
 * The value stored under the challenge OTP key: `<challengeId>:<digest>`
 * (ADR-019). The challenge ID is a UUIDv4 issued per issuance; binding it
 * into the stored value lets the resolve script consume only the exact
 * challenge whose digest was verified, never a replacement issued after
 * expiry.
 */
export interface OtpChallengeValue {
  readonly challengeId: string;
  readonly digest: string;
}

// Strict stored-value format: a UUIDv4, a colon, and the 64-hex digest.
const OTP_CHALLENGE_VALUE_PATTERN =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([0-9a-f]{64})$/;

export function composeOtpChallengeValue(challengeId: string, digest: string): string {
  return `${challengeId}:${digest}`;
}

/**
 * Parses a value retrieved from Redis into its challenge ID and digest.
 * A missing or malformed value (wrong shape, non-hex digest, non-UUID
 * identifier) yields `null` — callers must treat it as a failed
 * verification, never an exception.
 */
export function parseOtpChallengeValue(value: string | null): OtpChallengeValue | null {
  if (value === null) {
    return null;
  }
  const match = OTP_CHALLENGE_VALUE_PATTERN.exec(value);
  if (match === null) {
    return null;
  }
  return { challengeId: match[1], digest: match[2] };
}

/**
 * Timing-safe comparison of a computed digest against the digest part of a
 * parsed stored value. A missing or malformed stored value is a failed match
 * — never an exception and never compared with ordinary string equality.
 */
export function otpDigestMatches(submittedDigest: string, storedDigest: string): boolean {
  const submitted = Buffer.from(submittedDigest, 'hex');
  const stored = Buffer.from(storedDigest, 'hex');
  return timingSafeEqual(submitted, stored);
}
