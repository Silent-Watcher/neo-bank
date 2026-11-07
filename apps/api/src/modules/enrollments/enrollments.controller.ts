import { Body, Controller, HttpStatus, Post } from '@nestjs/common';
import { seconds, Throttle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { ZodValidationPipe } from '#src/shared/pipes/zod-validation.pipe.js';
import {
  problemDetailsSchema,
  successEnvelopeSchema,
  toJsonSchemaObject,
} from '#src/shared/swagger/openapi.schemas.js';

import { challengeRequestSchema, verifyRequestSchema } from './enrollments.schema.js';
import type { ChallengeRequestBody, VerifyRequestBody } from './enrollments.schema.js';
import { EnrollmentsService } from './enrollments.service.js';

// The Zod schemas stay the single source of truth for validation; their
// native JSON Schema output documents the request bodies, so the two cannot
// drift.
const challengeRequestJsonSchema = toJsonSchemaObject(challengeRequestSchema);
const verifyRequestJsonSchema = toJsonSchemaObject(verifyRequestSchema);

@ApiTags('enrollments')
@Controller('enrollments')
export class EnrollmentsController {
  constructor(private readonly enrollmentsService: EnrollmentsService) {}

  @Post('challenge')
  // Tighter per-IP issuance limit: 2 requests per 120 seconds (aligned with
  // the OTP validity window). The global short/long policies still apply.
  @Throttle({ short: { limit: 2, ttl: seconds(120) } })
  @ApiOperation({
    summary: 'Request an enrollment challenge',
    description:
      'Validates an Iranian mobile number (normalizing +98 / 0098 / 98 prefixes and a missing leading zero to the 09XXXXXXXXX format), generates a cryptographically random six-digit OTP, and stores it in Redis under the standard key naming convention with an exact 120-second expiry (atomic SET NX EX combined with a lockout check, so an OTP is never issued while a verification lockout is active). The OTP value is never included in the response and no SMS is sent yet; a later verification step will consume the stored code.',
  })
  @ApiBody({
    schema: challengeRequestJsonSchema,
    description:
      'The phone number is normalized before validation; the documented pattern is the validated form.',
  })
  @ApiOkResponse({
    description:
      'Challenge accepted and the OTP stored in Redis, wrapped in the standard response envelope. The payload carries only the phone number — the OTP value is intentionally absent.',
    schema: successEnvelopeSchema({
      type: 'object',
      properties: {
        phoneNumber: { type: 'string', examples: ['09121234567'] },
      },
      required: ['phoneNumber'],
    }),
  })
  @ApiBadRequestResponse({
    description: 'The phone number failed validation; served as RFC 9457 Problem Details.',
    schema: problemDetailsSchema,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      'Too many OTP requests for this phone number within the last 60 minutes (limit: 5), or a verification lockout is active after too many failed attempts. Served as RFC 9457 Problem Details with a generic message — the exact limit and lockout state are not exposed to clients.',
    schema: problemDetailsSchema,
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description:
      'The OTP could not be stored in Redis; served as RFC 9457 Problem Details with the application error code.',
    schema: problemDetailsSchema,
  })
  requestChallenge(
    @Body(new ZodValidationPipe(challengeRequestSchema)) body: ChallengeRequestBody,
  ) {
    return this.enrollmentsService.requestChallenge(body.phoneNumber);
  }

  @Post('verify')
  // Tighter per-IP verification limit: 5 requests per 120 seconds (aligned
  // with the max verification attempts and OTP validity window).
  @Throttle({ short: { limit: 5, ttl: seconds(120) } })
  @ApiOperation({
    summary: 'Verify an enrollment challenge',
    description:
      'Verifies the six-digit OTP previously issued for the phone number. On success the stored code is consumed. Verification failures are deliberately generic: the response never reveals whether the code was missing, expired, incorrect, or blocked by an active lockout. After too many failed attempts (configurable, default 5) a lockout is set that blocks both verification and new OTP issuance for a configurable window (default 15 minutes).',
  })
  @ApiBody({
    schema: verifyRequestJsonSchema,
    description:
      'The phone number is normalized before validation; the documented pattern is the validated form. The OTP is a six-character numeric string (leading zeros are significant).',
  })
  @ApiOkResponse({
    description:
      'Verification succeeded and the stored code was consumed, wrapped in the standard response envelope. The OTP is never part of any response.',
    schema: successEnvelopeSchema({
      type: 'object',
      properties: {
        phoneNumber: { type: 'string', examples: ['09121234567'] },
      },
      required: ['phoneNumber'],
    }),
  })
  @ApiBadRequestResponse({
    description:
      'Verification failed — the response is identical whether the code was missing, expired, or incorrect; served as RFC 9457 Problem Details.',
    schema: problemDetailsSchema,
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description:
      'The verification could not be completed; served as RFC 9457 Problem Details without internal details.',
    schema: problemDetailsSchema,
  })
  verify(
    @Body(new ZodValidationPipe(verifyRequestSchema)) { phoneNumber, otp }: VerifyRequestBody,
  ) {
    return this.enrollmentsService.verifyChallenge(phoneNumber, otp);
  }
}
