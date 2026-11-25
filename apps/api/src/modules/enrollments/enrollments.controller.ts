import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Idempotent } from '@nestjs/idempotency';
import { seconds, Throttle } from '@nestjs/throttler';

import { DeferredRateLimit } from '#src/shared/throttler/deferred-rate-limit.decorator.js';
import { DeferredRateLimitInterceptor } from '#src/shared/throttler/deferred-rate-limit.interceptor.js';
import { ZodValidationPipe } from '#src/shared/pipes/zod-validation.pipe.js';

import { challengeIdempotentOptions } from './enrollments.idempotency.js';
import type { ChallengeRequestBody, VerifyRequestBody } from './enrollments.schema.js';
import { challengeRequestSchema, verifyRequestSchema } from './enrollments.schema.js';
import {
  birthDateStepSchema,
  fullNameStepSchema,
  nationalCodeStepSchema,
  occupationStepSchema,
  passwordStepSchema,
  referralCodeStepSchema,
  usernameStepSchema,
  videoVerificationStepSchema,
} from './enrollments.schema.js';
import type {
  NationalCodeStepBody,
  FullNameStepBody,
  BirthDateStepBody,
  ReferralCodeStepBody,
  UsernameStepBody,
  PasswordStepBody,
  OccupationStepBody,
  VideoVerificationStepBody,
  StepSubmissionResponse,
} from './enrollments.schema.js';
import { EnrollmentsService } from './enrollments.service.js';

import {
  SwaggerRequestEnrollmentChallenge,
  SwaggerVerifyEnrollmentChallenge,
  SwaggerSubmitNationalCode,
  SwaggerSubmitFullName,
  SwaggerSubmitBirthDate,
  SwaggerSubmitReferralCode,
  SwaggerSubmitUsername,
  SwaggerSubmitPassword,
  SwaggerSubmitOccupation,
  SwaggerSubmitVideoVerification,
} from './enrollments.swagger.js';

@ApiTags('enrollments')
@Controller('enrollments')
export class EnrollmentsController {
  constructor(private readonly enrollmentsService: EnrollmentsService) {}

  @Post('challenge')
  @DeferredRateLimit()
  @Throttle({ short: { limit: 2, ttl: seconds(120) } })
  @UseInterceptors(DeferredRateLimitInterceptor)
  @Idempotent(challengeIdempotentOptions)
  @HttpCode(HttpStatus.ACCEPTED)
  @SwaggerRequestEnrollmentChallenge()
  requestChallenge(
    @Body(new ZodValidationPipe(challengeRequestSchema)) body: ChallengeRequestBody,
  ): Promise<void> {
    return this.enrollmentsService.requestChallenge(body.phoneNumber);
  }

  @Post('verify')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ short: { limit: 5, ttl: seconds(120) } })
  @SwaggerVerifyEnrollmentChallenge()
  verify(
    @Body(new ZodValidationPipe(verifyRequestSchema)) { phoneNumber, otp }: VerifyRequestBody,
  ) {
    return this.enrollmentsService.verifyChallenge(phoneNumber, otp);
  }

  // ---- Step Submission Endpoints ----

  // Per-IP rate limit for step submission: 20 requests per 120 seconds.
  // This is intentionally generous to allow form completion while providing
  // basic DoS protection. The actual attempt limits for OTP verification are
  // enforced in Redis; step submission limits guard the HTTP surface.
  private static readonly STEP_RATE_LIMIT = { limit: 20, ttl: seconds(120) };

  @Post(':publicId/step/national-code')
  @Throttle({ short: EnrollmentsController.STEP_RATE_LIMIT })
  @HttpCode(HttpStatus.OK)
  @SwaggerSubmitNationalCode()
  async submitNationalCode(
    @Param('publicId') publicId: string,
    @Body(new ZodValidationPipe(nationalCodeStepSchema)) body: NationalCodeStepBody,
  ): Promise<StepSubmissionResponse> {
    return this.enrollmentsService.submitStep(
      publicId,
      'NATIONAL_CODE',
      new Date(),
      (enrollment) => {
        enrollment.nationalCode = body.nationalCode;
      },
    );
  }

  @Post(':publicId/step/full-name')
  @Throttle({ short: EnrollmentsController.STEP_RATE_LIMIT })
  @HttpCode(HttpStatus.OK)
  @SwaggerSubmitFullName()
  async submitFullName(
    @Param('publicId') publicId: string,
    @Body(new ZodValidationPipe(fullNameStepSchema)) body: FullNameStepBody,
  ): Promise<StepSubmissionResponse> {
    return this.enrollmentsService.submitStep(publicId, 'FULL_NAME', new Date(), (enrollment) => {
      enrollment.firstName = body.firstName;
      enrollment.lastName = body.lastName;
    });
  }

  @Post(':publicId/step/birth-date')
  @Throttle({ short: EnrollmentsController.STEP_RATE_LIMIT })
  @HttpCode(HttpStatus.OK)
  @SwaggerSubmitBirthDate()
  async submitBirthDate(
    @Param('publicId') publicId: string,
    @Body(new ZodValidationPipe(birthDateStepSchema)) body: BirthDateStepBody,
  ): Promise<StepSubmissionResponse> {
    return this.enrollmentsService.submitStep(publicId, 'BIRTH_DATE', new Date(), (enrollment) => {
      enrollment.birthDate = body.birthDate;
    });
  }

  @Post(':publicId/step/referral-code')
  @Throttle({ short: EnrollmentsController.STEP_RATE_LIMIT })
  @HttpCode(HttpStatus.OK)
  @SwaggerSubmitReferralCode()
  async submitReferralCode(
    @Param('publicId') publicId: string,
    @Body(new ZodValidationPipe(referralCodeStepSchema)) body: ReferralCodeStepBody,
  ): Promise<StepSubmissionResponse> {
    return this.enrollmentsService.submitStep(
      publicId,
      'REFERRAL_CODE',
      new Date(),
      (enrollment) => {
        enrollment.referralCode = body.referralCode ?? null;
      },
    );
  }

  @Post(':publicId/step/username')
  @Throttle({ short: EnrollmentsController.STEP_RATE_LIMIT })
  @HttpCode(HttpStatus.OK)
  @SwaggerSubmitUsername()
  async submitUsername(
    @Param('publicId') publicId: string,
    @Body(new ZodValidationPipe(usernameStepSchema)) body: UsernameStepBody,
  ): Promise<StepSubmissionResponse> {
    // The Zod schema already normalizes to lowercase (ADR-042).
    return this.enrollmentsService.submitStep(publicId, 'USERNAME', new Date(), (enrollment) => {
      enrollment.username = body.username;
    });
  }

  @Post(':publicId/step/password')
  @Throttle({ short: EnrollmentsController.STEP_RATE_LIMIT })
  @HttpCode(HttpStatus.OK)
  @SwaggerSubmitPassword()
  async submitPassword(
    @Param('publicId') publicId: string,
    @Body(new ZodValidationPipe(passwordStepSchema)) body: PasswordStepBody,
  ): Promise<StepSubmissionResponse> {
    // Hash the password before passing to the service (DEFERRED _061 #3: SEC-02,
    // CWE-20 — client input never reaches password_hash column verbatim).
    const passwordHash = await this.enrollmentsService.hashPassword(body.password);
    return this.enrollmentsService.submitStep(publicId, 'PASSWORD', new Date(), (enrollment) => {
      enrollment.passwordHash = passwordHash;
    });
  }

  @Post(':publicId/step/occupation')
  @Throttle({ short: EnrollmentsController.STEP_RATE_LIMIT })
  @HttpCode(HttpStatus.OK)
  @SwaggerSubmitOccupation()
  async submitOccupation(
    @Param('publicId') publicId: string,
    @Body(new ZodValidationPipe(occupationStepSchema)) body: OccupationStepBody,
  ): Promise<StepSubmissionResponse> {
    return this.enrollmentsService.submitStep(publicId, 'OCCUPATION', new Date(), (enrollment) => {
      enrollment.occupation = body.occupation;
    });
  }

  @Post(':publicId/step/video-verification')
  @Throttle({ short: EnrollmentsController.STEP_RATE_LIMIT })
  @HttpCode(HttpStatus.OK)
  @SwaggerSubmitVideoVerification()
  async submitVideoVerification(
    @Param('publicId') publicId: string,
    @Body(new ZodValidationPipe(videoVerificationStepSchema)) _body: VideoVerificationStepBody,
  ): Promise<StepSubmissionResponse> {
    // Video key is set by the deferred upload flow; for now we just complete
    // the step with an empty apply callback (the state machine handles the
    // COMPLETED transition and PENDING_REVIEW status).
    return this.enrollmentsService.submitStep(publicId, 'VIDEO_VERIFICATION', new Date(), () => {
      // videoKey will be set by the deferred upload integration
    });
  }
}
