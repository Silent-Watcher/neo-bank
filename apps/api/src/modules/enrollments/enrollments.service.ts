import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';

import { RedisService } from '#src/shared/redis/redis.service.js';

import { challengeOtpKey } from './enrollments.keys.js';

// OTPs cover every six-digit code from 100000 to 999999; randomInt's upper
// bound is exclusive, hence the + 1 at the call site.
const OTP_MIN = 100_000;
const OTP_MAX = 999_999;

// The challenge OTP expires exactly 120 seconds after it is issued.
export const CHALLENGE_OTP_TTL_SECONDS = 120;

@Injectable()
export class EnrollmentsService {
  constructor(private readonly redisService: RedisService) {}

  // Temporary: the OTP is generated and stored in one step; delivery and
  // verification replace this when the feature grows.
  async requestChallenge(phoneNumber: string): Promise<{ phoneNumber: string }> {
    const otp = randomInt(OTP_MIN, OTP_MAX + 1).toString();
    await this.redisService.set(challengeOtpKey(phoneNumber), otp, {
      ttlSeconds: CHALLENGE_OTP_TTL_SECONDS,
    });

    // The OTP is deliberately not returned: delivery is not implemented yet.
    return { phoneNumber };
  }
}
