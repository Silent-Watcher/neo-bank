import { Body, Controller, HttpStatus, Post } from '@nestjs/common';
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

import { challengeRequestSchema } from './enrollments.schema.js';
import type { ChallengeRequestBody } from './enrollments.schema.js';
import { EnrollmentsService } from './enrollments.service.js';

// The Zod schema stays the single source of truth for validation; its native
// JSON Schema output documents the request body, so the two cannot drift.
const challengeRequestJsonSchema = toJsonSchemaObject(challengeRequestSchema);

@ApiTags('enrollments')
@Controller('enrollments')
export class EnrollmentsController {
  constructor(private readonly enrollmentsService: EnrollmentsService) {}

  @Post('challenge')
  @ApiOperation({
    summary: 'Request an enrollment challenge',
    description:
      'Validates an Iranian mobile number (normalizing +98 / 0098 / 98 prefixes and a missing leading zero to the 09XXXXXXXXX format), generates a cryptographically random six-digit OTP, and stores it in Redis under the standard key naming convention with an exact 120-second expiry. The OTP value is never included in the response and no SMS is sent yet; a later verification step will consume the stored code.',
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
}
