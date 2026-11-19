import { Body, Controller, HttpCode, HttpStatus, Post, UseInterceptors } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Idempotent } from '@nestjs/idempotency';
import { seconds, Throttle } from '@nestjs/throttler';

import { DeferredRateLimit } from '#src/shared/throttler/deferred-rate-limit.decorator.js';
import { ZodValidationPipe } from '#src/shared/pipes/zod-validation.pipe.js';
import {
  problemDetailsSchema,
  successEnvelopeSchema,
  toJsonSchemaObject,
} from '#swagger/openapi.schemas.js';

import { ChallengeRateLimitInterceptor } from './challenge-rate-limit.interceptor.js';
import { challengeIdempotentOptions } from './enrollments.idempotency.js';
import type { ChallengeRequestBody, VerifyRequestBody } from './enrollments.schema.js';
import { challengeRequestSchema, verifyRequestSchema } from './enrollments.schema.js';
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
  // Rate-limit enforcement is deferred to the route-level interceptor below
  // (ADR-039): the global guard skips this route — replays and in-flight
  // idempotency duplicates must not consume quota — and the interceptor
  // re-enforces the same quota after the idempotency acquire gate. The
  // per-IP issuance limit stays 2 requests per 120 seconds (aligned with the
  // OTP validity window); the global long policy still applies.
  @DeferredRateLimit()
  @Throttle({ short: { limit: 2, ttl: seconds(120) } })
  @UseInterceptors(ChallengeRateLimitInterceptor)
  // Idempotent challenge issuance (ADR-039): the required Idempotency-Key
  // header identifies the logical operation. A completed retry replays the
  // stored empty 202 without executing the handler again or consuming
  // rate-limit quota; a concurrent duplicate receives 409
  // IDEMPOTENCY_KEY_IN_USE; a key reused with a different request is
  // rejected with 422 IDEMPOTENCY_KEY_REUSED.
  @Idempotent(challengeIdempotentOptions)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Request an enrollment challenge',
    description:
      'Validates an Iranian mobile number (normalizing +98 / 0098 / 98 prefixes and a missing leading zero to the 09XXXXXXXXX format), generates a cryptographically random six-digit OTP, and stores it in Redis under the standard key naming convention with an exact 120-second expiry (atomic SET NX EX combined with a lockout check, so an OTP is never issued while a verification lockout is active). The OTP value is never included in the response and no SMS is sent yet; a later verification step will consume the stored code. The endpoint is idempotent: a retry of the same logical operation (same Idempotency-Key) replays the stored empty 202 without issuing a new OTP or consuming rate-limit quota. Equivalent phone spellings (+98 / 0098 / 98 / missing leading zero) map to the same idempotency scope and fingerprint.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Unique key identifying this logical challenge operation. Generate a new random key for every new challenge request and reuse exactly the same key for retries of that operation; a new intentional request must use a new key. Keys are 1–255 printable ASCII characters.',
    schema: { type: 'string', minLength: 1, maxLength: 255 },
  })
  @ApiBody({
    schema: challengeRequestJsonSchema,
    description:
      'The phone number is normalized before validation; the documented pattern is the validated form.',
  })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description:
      'Challenge accepted and the OTP stored in Redis. The response body is intentionally empty — the phone number and the OTP value are never included. A completed request replayed with the same Idempotency-Key returns the identical empty 202 with an `Idempotent-Replayed: true` header and consumes no rate-limit quota.',
  })
  @ApiBadRequestResponse({
    description:
      'The phone number failed validation, or the Idempotency-Key header is missing or malformed; served as RFC 9457 Problem Details.',
    schema: problemDetailsSchema,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      'Too many OTP requests for this phone number within the last 60 minutes (limit: 5), or a verification lockout is active after too many failed attempts. Served as RFC 9457 Problem Details with a generic message — the exact limit and lockout state are not exposed to clients.',
    schema: problemDetailsSchema,
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description:
      'A request with the same Idempotency-Key is still being processed (IDEMPOTENCY_KEY_IN_USE). Retry after the `Retry-After` delay; the duplicate consumes no rate-limit quota. Served as RFC 9457 Problem Details.',
    schema: problemDetailsSchema,
  })
  @ApiResponse({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    description:
      'The Idempotency-Key was already used for a different request in the same scope (IDEMPOTENCY_KEY_REUSED). A new logical operation requires a new key. Served as RFC 9457 Problem Details.',
    schema: problemDetailsSchema,
  })
  @ApiResponse({
    status: HttpStatus.TOO_MANY_REQUESTS,
    description:
      'The per-IP rate limit for this endpoint was exceeded. This rejection is never stored as an idempotency result — a retry with the same Idempotency-Key after the rate-limit window executes normally. Served as RFC 9457 Problem Details.',
    schema: problemDetailsSchema,
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description:
      'The OTP could not be stored in Redis, or the idempotency store is unavailable; served as RFC 9457 Problem Details with the application error code.',
    schema: problemDetailsSchema,
  })
  requestChallenge(
    @Body(new ZodValidationPipe(challengeRequestSchema)) body: ChallengeRequestBody,
  ): Promise<void> {
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
