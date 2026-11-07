import { randomInt } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppHttpException } from '#errors/app-http.exception.js';
import { ErrorCode } from '#errors/error.code.js';
import { RedisService } from '#src/shared/redis/redis.service.js';
import { ENROLLMENTS_CONFIG } from '#config/enrollments.config.js';

import {
  challengeAttemptsKey,
  challengeOtpKey,
  challengeRateLimitKey,
} from './enrollments.keys.js';

// OTPs cover every six-digit code from 100000 to 999999; randomInt's upper
// bound is exclusive, hence the + 1 at the call site.
const OTP_MIN = 100_000;
const OTP_MAX = 999_999;

// The challenge OTP expires exactly 120 seconds after it is issued.
export const CHALLENGE_OTP_TTL_SECONDS = 120;

// Maximum OTP sends allowed per phone number within a rolling 60-minute window.
const MAX_OTP_SENDS_PER_HOUR = 5;

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
      60,
    );

    if (!allowed) {
      throw new AppHttpException(
        ErrorCode.OtpRateLimitExceeded,
        OTP_RATE_LIMIT_DETAIL,
        HttpStatus.BAD_REQUEST,
      );
    }

    const otp = randomInt(OTP_MIN, OTP_MAX + 1).toString();
    const key = challengeOtpKey(phoneNumber);
    const created = await this.redisService.setNxEx(key, otp, CHALLENGE_OTP_TTL_SECONDS);

    if (!created) {
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
    const maxAttempts = this.configService.getOrThrow<{ maxVerifyAttempts: number }>(
      ENROLLMENTS_CONFIG,
    ).maxVerifyAttempts;
    const otpKey = challengeOtpKey(phone);
    const attemptsKey = challengeAttemptsKey(phone);

    const verified = await this.redisService.verifyOtpAndCountAttempts(
      otpKey,
      attemptsKey,
      otp,
      maxAttempts,
      CHALLENGE_OTP_TTL_SECONDS,
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
