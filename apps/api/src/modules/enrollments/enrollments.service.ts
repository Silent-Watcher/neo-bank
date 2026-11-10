import { randomInt, randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppHttpException } from '#errors/app-http.exception.js';
import { ErrorCode } from '#errors/error.code.js';
import { RedisService } from '#src/shared/redis/redis.service.js';
import { ENROLLMENTS_CONFIG } from '#config/enrollments.config.js';
import type { EnrollmentsConfig } from '#config/enrollments.config.js';

import {
  challengeAttemptsKey,
  challengeLockoutKey,
  challengeOtpKey,
  challengeRateLimitKey,
} from './enrollments.keys.js';
import {
  composeOtpChallengeValue,
  computeOtpDigest,
  otpDigestMatches,
  parseOtpChallengeValue,
} from './enrollments.otp-digest.js';

// OTPs cover every six-digit code from 100000 to 999999; randomInt's upper
// bound is exclusive, hence the + 1 at the call site.
const OTP_MIN = 100_000;
const OTP_MAX = 999_999;

// The challenge OTP expires exactly 120 seconds after it is issued.
export const CHALLENGE_OTP_TTL_SECONDS = 120;

// Maximum OTP sends allowed per phone number within a rolling 60-minute window.
const MAX_OTP_SENDS_PER_HOUR = 5;

// Width of the rolling window for the per-phone send quota, in minutes.
const OTP_SEND_WINDOW_MINUTES = 60;

// Single generic message for every verification failure — missing, expired,
// or incorrect OTPs are deliberately indistinguishable to clients.
const VERIFICATION_FAILED_DETAIL = 'Phone number verification failed.';

// Single generic message for OTP rate limit exceeded — the hourly quota is
// deliberately indistinguishable from the cooldown to clients.
const OTP_RATE_LIMIT_DETAIL = 'Too many OTP requests. Please try again later.';

@Injectable()
export class EnrollmentsService {
  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  async requestChallenge(phoneNumber: string): Promise<{ phoneNumber: string }> {
    // First, check the per-phone hourly rate limit (rolling 60-minute window).
    // This is independent of the 120-second cooldown and IP-based rate limiting.
    const rateLimitKey = challengeRateLimitKey(phoneNumber);
    const allowed = await this.redisService.checkOtpRateLimit(
      rateLimitKey,
      MAX_OTP_SENDS_PER_HOUR,
      OTP_SEND_WINDOW_MINUTES,
    );

    if (!allowed) {
      throw new AppHttpException(
        ErrorCode.OtpRateLimitExceeded,
        OTP_RATE_LIMIT_DETAIL,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Atomically check the lockout and store the challenge value: an OTP can
    // never be issued while a verification lockout is active for this phone
    // number. Only the HMAC digest — bound to a per-issuance challenge ID — is
    // stored; the plaintext OTP never reaches Redis (ADR-018/019).
    const otp = randomInt(OTP_MIN, OTP_MAX + 1).toString();
    const { otpHmacSecret } = this.configService.getOrThrow<EnrollmentsConfig>(ENROLLMENTS_CONFIG);
    const otpDigest = computeOtpDigest(phoneNumber, otp, otpHmacSecret);
    const challengeValue = composeOtpChallengeValue(randomUUID(), otpDigest);
    const issueResult = await this.redisService.issueOtp(
      challengeOtpKey(phoneNumber),
      challengeLockoutKey(phoneNumber),
      challengeValue,
      CHALLENGE_OTP_TTL_SECONDS,
    );

    if (issueResult === 'locked') {
      // Indistinguishable from the hourly quota to clients: same error code and
      // generic detail, so the lockout state is not disclosed.
      throw new AppHttpException(
        ErrorCode.OtpRateLimitExceeded,
        OTP_RATE_LIMIT_DETAIL,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (issueResult === 'exists') {
      throw new AppHttpException(
        ErrorCode.OtpVerificationFailed,
        VERIFICATION_FAILED_DETAIL,
        HttpStatus.BAD_REQUEST,
      );
    }

    // The OTP is deliberately not returned: delivery is not implemented yet.
    return { phoneNumber };
  }

  async verifyChallenge(phone: string, otp: string): Promise<{ phoneNumber: string }> {
    const { maxVerifyAttempts, lockoutTtlSeconds, otpHmacSecret } =
      this.configService.getOrThrow<EnrollmentsConfig>(ENROLLMENTS_CONFIG);

    // The digest comparison happens in Node (timing-safe, ADR-018); the
    // script below only transitions the Redis state atomically, consuming
    // only the exact challenge whose digest matched (challenge identity,
    // ADR-019). A missing or malformed stored value is a failed match, never
    // an exception.
    const otpKey = challengeOtpKey(phone);
    const storedChallenge = parseOtpChallengeValue(await this.redisService.get(otpKey));
    const submittedDigest = computeOtpDigest(phone, otp, otpHmacSecret);
    const matched =
      storedChallenge !== null && otpDigestMatches(submittedDigest, storedChallenge.digest);

    const verified = await this.redisService.resolveOtpVerification(
      otpKey,
      challengeAttemptsKey(phone),
      challengeLockoutKey(phone),
      storedChallenge?.challengeId ?? '',
      matched,
      maxVerifyAttempts,
      lockoutTtlSeconds,
    );

    if (!verified) {
      throw new AppHttpException(
        ErrorCode.OtpVerificationFailed,
        VERIFICATION_FAILED_DETAIL,
        HttpStatus.BAD_REQUEST,
      );
    }

    return { phoneNumber: phone };
  }
}
