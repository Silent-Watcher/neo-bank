import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { ZodValidationPipe } from '#src/shared/pipes/zod-validation.pipe.js';
import {
  problemDetailsSchema,
  successEnvelopeSchema,
  toJsonSchemaObject,
} from '#src/shared/swagger/openapi.schemas.js';

import { requestOtpSchema } from './enrollments.schema.js';
import type { RequestOtpBody } from './enrollments.schema.js';
import { EnrollmentsService } from './enrollments.service.js';

// The Zod schema stays the single source of truth for validation; its native
// JSON Schema output documents the request body, so the two cannot drift.
const requestOtpJsonSchema = toJsonSchemaObject(requestOtpSchema);

@ApiTags('enrollments')
@Controller('enrollments')
export class EnrollmentsController {
  constructor(private readonly enrollmentsService: EnrollmentsService) {}

  @Post('otp')
  @ApiOperation({
    summary: 'Request a phone OTP',
    description:
      'Validates an Iranian mobile number (normalizing +98 / 0098 / 98 prefixes and a missing leading zero to the 09XXXXXXXXX format) and returns a cryptographically random six-digit OTP. The OTP is not yet stored, delivered, or verifiable.',
  })
  @ApiBody({
    schema: requestOtpJsonSchema,
    description:
      'The phone number is normalized before validation; the documented pattern is the validated form.',
  })
  @ApiOkResponse({
    description: 'OTP generated successfully, wrapped in the standard response envelope.',
    schema: successEnvelopeSchema({
      type: 'object',
      properties: {
        phoneNumber: { type: 'string', examples: ['09121234567'] },
        otp: { type: 'string', pattern: '^\\d{6}$' },
      },
      required: ['phoneNumber', 'otp'],
    }),
  })
  @ApiBadRequestResponse({
    description: 'The phone number failed validation; served as RFC 9457 Problem Details.',
    schema: problemDetailsSchema,
  })
  requestOtp(@Body(new ZodValidationPipe(requestOtpSchema)) body: RequestOtpBody) {
    return this.enrollmentsService.requestOtp(body.phoneNumber);
  }
}
