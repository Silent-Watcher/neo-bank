import { randomInt } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppHttpException } from '#errors/app-http.exception.js';
import { ErrorCode } from '#errors/error.code.js';
import { RedisService } from '#src/shared/redis/redis.service.js';
import { ENROLLMENTS_CONFIG } from '#config/enrollments.config.js';

import { challengeAttemptsKey, challengeOtpKey } from './enrollments.keys.js';

// OTPs cover every six-digit code from 100000 to 999999; randomInt's upper
// bound is exclusive, hence the + 1 at the call site.
const OTP_MIN = 100_000;
const OTP_MAX = 999_999;

// The challenge OTP expires exactly 120 seconds after it is issued.
export const CHALLENGE_OTP_TTL_SECONDS = 120;

// Single generic message for every verification failure — missing, expired,
// or incorrect OTPs are deliberately indistinguishable to clients.
const VERIFICATION_FAILED_DETAIL = 'Phone number verification failed.';

@Injectable()
export class EnrollmentsService {
  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  async requestChallenge(phoneNumber: string): Promise<{ phoneNumber: string }> {
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
