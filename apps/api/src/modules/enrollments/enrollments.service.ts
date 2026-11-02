import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';

// OTPs cover every six-digit code from 100000 to 999999; randomInt's upper
// bound is exclusive, hence the + 1 at the call site.
const OTP_MIN = 100_000;
const OTP_MAX = 999_999;

@Injectable()
export class EnrollmentsService {
  // Temporary: the OTP is generated and returned in one step; storage,
  // delivery, verification and expiry replace this when the feature grows.
  requestOtp(phoneNumber: string): { phoneNumber: string; otp: string } {
    return { phoneNumber, otp: randomInt(OTP_MIN, OTP_MAX + 1).toString() };
  }
}
