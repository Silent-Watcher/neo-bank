import { HttpStatus, applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';

import {
  challengeRequestJsonSchema,
  verifyRequestJsonSchema,
  nationalCodeStepJsonSchema,
  fullNameStepJsonSchema,
  birthDateStepJsonSchema,
  referralCodeStepJsonSchema,
  usernameStepJsonSchema,
  passwordStepJsonSchema,
  occupationStepJsonSchema,
  videoVerificationStepJsonSchema,
  stepSubmissionResponseSchema,
} from './enrollments.schema.js';

import { problemDetailsSchema, successEnvelopeSchema } from '#swagger/openapi.schemas.js';

export function SwaggerRequestEnrollmentChallenge() {
  return applyDecorators(
    ApiOperation({
      summary: 'Request an enrollment challenge',
      description:
        'Validates an Iranian mobile number (normalizing +98 / 0098 / 98 prefixes and a missing leading zero to the 09XXXXXXXXX format), generates a cryptographically random six-digit OTP, and stores it in Redis under the standard key naming convention with an exact 120-second expiry (atomic SET NX EX combined with a lockout check, so an OTP is never issued while a verification lockout is active). The OTP value is never included in the response and no SMS is sent yet; a later verification step will consume the stored code. The endpoint is idempotent: a retry of the same logical operation (same Idempotency-Key) replays the stored empty 202 without issuing a new OTP or consuming rate-limit quota. Equivalent phone spellings (+98 / 0098 / 98 / missing leading zero) map to the same idempotency scope and fingerprint.',
    }),
    ApiHeader({
      name: 'Idempotency-Key',
      required: true,
      description:
        'Unique key identifying this logical challenge operation. Generate a new random key for every new challenge request and reuse exactly the same key for retries of that operation; a new intentional request must use a new key. Keys are 1–255 printable ASCII characters.',
      schema: { type: 'string', minLength: 1, maxLength: 255 },
    }),
    ApiBody({
      schema: challengeRequestJsonSchema,
      description:
        'The phone number is normalized before validation; the documented pattern is the validated form.',
    }),
    ApiResponse({
      status: HttpStatus.ACCEPTED,
      description:
        'Challenge accepted and the OTP stored in Redis. The response body is intentionally empty — the phone number and the OTP value are never included. A completed request replayed with the same Idempotency-Key returns the identical empty 202 with an `Idempotent-Replayed: true` header and consumes no rate-limit quota.',
    }),
    ApiBadRequestResponse({
      description:
        'The phone number failed validation, the Idempotency-Key header is missing or malformed, or the OTP issuance limit / verification lockout was exceeded. Served as RFC 9457 Problem Details.',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.CONFLICT,
      description:
        'A request with the same Idempotency-Key is still being processed (IDEMPOTENCY_KEY_IN_USE). Retry after the `Retry-After` delay; the duplicate consumes no rate-limit quota. Served as RFC 9457 Problem Details.',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      description:
        'The Idempotency-Key was already used for a different request in the same scope (IDEMPOTENCY_KEY_REUSED). A new logical operation requires a new key. Served as RFC 9457 Problem Details.',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.TOO_MANY_REQUESTS,
      description:
        'The per-IP rate limit for this endpoint was exceeded. This rejection is never stored as an idempotency result — a retry with the same Idempotency-Key after the rate-limit window executes normally. Served as RFC 9457 Problem Details.',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      description:
        'The OTP could not be stored in Redis, or the idempotency store is unavailable; served as RFC 9457 Problem Details with the application error code.',
      schema: problemDetailsSchema,
    }),
  );
}

export function SwaggerVerifyEnrollmentChallenge() {
  return applyDecorators(
    ApiOperation({
      summary: 'Verify an enrollment challenge',
      description:
        'Verifies the six-digit OTP previously issued for the phone number. On success the stored code is consumed. Verification failures are deliberately generic: the response never reveals whether the code was missing, expired, incorrect, or blocked by an active lockout. After too many failed attempts (configurable, default 5) a lockout is set that blocks both verification and new OTP issuance for a configurable window (default 15 minutes).',
    }),
    ApiBody({
      schema: verifyRequestJsonSchema,
      description:
        'The phone number is normalized before validation; the documented pattern is the validated form. The OTP is a six-character numeric string (leading zeros are significant).',
    }),
    ApiResponse({
      status: HttpStatus.CREATED,
      description:
        'Verification succeeded and the stored code was consumed; the enrollment for this phone now exists (or is reset to INITIAL if it had expired). Wrapped in the standard response envelope.',
      schema: successEnvelopeSchema({
        type: 'object',
        properties: {
          phoneNumber: { type: 'string', examples: ['09121234567'] },
          publicId: {
            type: 'string',
            format: 'uuid',
            example: '018f4b2e-7c0a-7d3f-a5b9-1e2c3d4f5a6b',
          },
        },
        required: ['phoneNumber', 'publicId'],
      }),
    }),
    ApiBadRequestResponse({
      description:
        'Verification failed — the response is identical whether the code was missing, expired, or incorrect; served as RFC 9457 Problem Details.',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      description:
        'The verification could not be completed; served as RFC 9457 Problem Details without internal details.',
      schema: problemDetailsSchema,
    }),
  );
}

export function SwaggerSubmitNationalCode() {
  return applyDecorators(
    ApiOperation({
      summary: 'Submit national code step',
      description:
        'Submits the Iranian national code (10 digits). This is the first step of the enrollment form. On success the enrollment advances to FULL_NAME and status becomes IN_PROGRESS.',
    }),
    ApiParam({
      name: 'publicId',
      type: 'string',
      format: 'uuid',
      description: 'The enrollment public identifier returned from verify.',
    }),
    ApiBody({
      schema: nationalCodeStepJsonSchema,
      description: 'National code in the validated 10-digit format.',
    }),
    ApiOkResponse({
      description: 'Step submitted successfully; enrollment advanced to FULL_NAME.',
      schema: stepSubmissionResponseSchema,
    }),
    ApiBadRequestResponse({
      description: 'Validation failed; served as RFC 9457 Problem Details.',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.CONFLICT,
      description:
        'Step not allowed in current state (expired, wrong step order, non-receptive status), or national code already enrolled. Served as RFC 9457 Problem Details.',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.GONE,
      description:
        'Enrollment has expired and can no longer be continued. The expiration transition was persisted before this response. Served as RFC 9457 Problem Details.',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.NOT_FOUND,
      description:
        'Enrollment not found (invalid publicId or insufficient authorization — BOLA exposure per DEFERRED.md; auth deferred).',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.TOO_MANY_REQUESTS,
      description: 'Per-IP rate limit exceeded.',
      schema: problemDetailsSchema,
    }),
  );
}

export function SwaggerSubmitFullName() {
  return applyDecorators(
    ApiOperation({
      summary: 'Submit full name step',
      description:
        "Submits the customer's first and last name. On success the enrollment advances to BIRTH_DATE.",
    }),
    ApiParam({
      name: 'publicId',
      type: 'string',
      format: 'uuid',
      description: 'The enrollment public identifier returned from verify.',
    }),
    ApiBody({
      schema: fullNameStepJsonSchema,
      description: 'First name and last name (each max 50 characters).',
    }),
    ApiOkResponse({
      description: 'Step submitted successfully; enrollment advanced to BIRTH_DATE.',
      schema: stepSubmissionResponseSchema,
    }),
    ApiBadRequestResponse({
      description: 'Validation failed; served as RFC 9457 Problem Details.',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.CONFLICT,
      description: 'Step not allowed in current state. Served as RFC 9457 Problem Details.',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.GONE,
      description: 'Enrollment has expired. Served as RFC 9457 Problem Details.',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.NOT_FOUND,
      description: 'Enrollment not found (BOLA exposure — auth deferred).',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.TOO_MANY_REQUESTS,
      description: 'Per-IP rate limit exceeded.',
      schema: problemDetailsSchema,
    }),
  );
}

export function SwaggerSubmitBirthDate() {
  return applyDecorators(
    ApiOperation({
      summary: 'Submit birth date step',
      description:
        "Submits the customer's birth date (YYYY-MM-DD). On success the enrollment advances to REFERRAL_CODE.",
    }),
    ApiParam({
      name: 'publicId',
      type: 'string',
      format: 'uuid',
      description: 'The enrollment public identifier returned from verify.',
    }),
    ApiBody({
      schema: birthDateStepJsonSchema,
      description: 'Birth date in YYYY-MM-DD format.',
    }),
    ApiOkResponse({
      description: 'Step submitted successfully; enrollment advanced to REFERRAL_CODE.',
      schema: stepSubmissionResponseSchema,
    }),
    ApiBadRequestResponse({
      description: 'Validation failed; served as RFC 9457 Problem Details.',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.CONFLICT,
      description: 'Step not allowed in current state. Served as RFC 9457 Problem Details.',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.GONE,
      description: 'Enrollment has expired. Served as RFC 9457 Problem Details.',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.NOT_FOUND,
      description: 'Enrollment not found (BOLA exposure — auth deferred).',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.TOO_MANY_REQUESTS,
      description: 'Per-IP rate limit exceeded.',
      schema: problemDetailsSchema,
    }),
  );
}

export function SwaggerSubmitReferralCode() {
  return applyDecorators(
    ApiOperation({
      summary: 'Submit referral code step',
      description:
        'Submits an optional referral code (max 20 characters). On success the enrollment advances to USERNAME.',
    }),
    ApiParam({
      name: 'publicId',
      type: 'string',
      format: 'uuid',
      description: 'The enrollment public identifier returned from verify.',
    }),
    ApiBody({
      schema: referralCodeStepJsonSchema,
      description: 'Optional referral code (max 20 characters).',
    }),
    ApiOkResponse({
      description: 'Step submitted successfully; enrollment advanced to USERNAME.',
      schema: stepSubmissionResponseSchema,
    }),
    ApiBadRequestResponse({
      description: 'Validation failed; served as RFC 9457 Problem Details.',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.CONFLICT,
      description: 'Step not allowed in current state. Served as RFC 9457 Problem Details.',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.GONE,
      description: 'Enrollment has expired. Served as RFC 9457 Problem Details.',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.NOT_FOUND,
      description: 'Enrollment not found (BOLA exposure — auth deferred).',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.TOO_MANY_REQUESTS,
      description: 'Per-IP rate limit exceeded.',
      schema: problemDetailsSchema,
    }),
  );
}

export function SwaggerSubmitUsername() {
  return applyDecorators(
    ApiOperation({
      summary: 'Submit username step',
      description:
        'Submits the desired username (3-30 lowercase alphanumeric with . _ -). The username is normalized to lowercase before persistence. On success the enrollment advances to PASSWORD.',
    }),
    ApiParam({
      name: 'publicId',
      type: 'string',
      format: 'uuid',
      description: 'The enrollment public identifier returned from verify.',
    }),
    ApiBody({
      schema: usernameStepJsonSchema,
      description:
        'Username in the validated format (lowercase, 3-30 chars, alphanumeric with . _ -).',
    }),
    ApiOkResponse({
      description: 'Step submitted successfully; enrollment advanced to PASSWORD.',
      schema: stepSubmissionResponseSchema,
    }),
    ApiBadRequestResponse({
      description: 'Validation failed; served as RFC 9457 Problem Details.',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.CONFLICT,
      description:
        'Step not allowed in current state, or username already taken. Served as RFC 9457 Problem Details.',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.GONE,
      description: 'Enrollment has expired. Served as RFC 9457 Problem Details.',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.NOT_FOUND,
      description: 'Enrollment not found (BOLA exposure — auth deferred).',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.TOO_MANY_REQUESTS,
      description: 'Per-IP rate limit exceeded.',
      schema: problemDetailsSchema,
    }),
  );
}

export function SwaggerSubmitPassword() {
  return applyDecorators(
    ApiOperation({
      summary: 'Submit password step',
      description:
        'Submits the plaintext password (min 8 chars, max 72, at least one letter and one digit). The service hashes it with Argon2id (memory 19456 KiB, time cost 2, parallelism 1) before persisting. On success the enrollment advances to OCCUPATION.',
    }),
    ApiParam({
      name: 'publicId',
      type: 'string',
      format: 'uuid',
      description: 'The enrollment public identifier returned from verify.',
    }),
    ApiBody({
      schema: passwordStepJsonSchema,
      description: 'Plaintext password (will be hashed server-side).',
    }),
    ApiOkResponse({
      description: 'Step submitted successfully; enrollment advanced to OCCUPATION.',
      schema: stepSubmissionResponseSchema,
    }),
    ApiBadRequestResponse({
      description: 'Validation failed; served as RFC 9457 Problem Details.',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.CONFLICT,
      description: 'Step not allowed in current state. Served as RFC 9457 Problem Details.',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.GONE,
      description: 'Enrollment has expired. Served as RFC 9457 Problem Details.',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.NOT_FOUND,
      description: 'Enrollment not found (BOLA exposure — auth deferred).',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.TOO_MANY_REQUESTS,
      description: 'Per-IP rate limit exceeded.',
      schema: problemDetailsSchema,
    }),
  );
}

export function SwaggerSubmitOccupation() {
  return applyDecorators(
    ApiOperation({
      summary: 'Submit occupation step',
      description:
        "Submits the customer's occupation (free text, max 100 characters). On success the enrollment advances to VIDEO_VERIFICATION.",
    }),
    ApiParam({
      name: 'publicId',
      type: 'string',
      format: 'uuid',
      description: 'The enrollment public identifier returned from verify.',
    }),
    ApiBody({
      schema: occupationStepJsonSchema,
      description: 'Occupation (max 100 characters).',
    }),
    ApiOkResponse({
      description: 'Step submitted successfully; enrollment advanced to VIDEO_VERIFICATION.',
      schema: stepSubmissionResponseSchema,
    }),
    ApiBadRequestResponse({
      description: 'Validation failed; served as RFC 9457 Problem Details.',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.CONFLICT,
      description: 'Step not allowed in current state. Served as RFC 9457 Problem Details.',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.GONE,
      description: 'Enrollment has expired. Served as RFC 9457 Problem Details.',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.NOT_FOUND,
      description: 'Enrollment not found (BOLA exposure — auth deferred).',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.TOO_MANY_REQUESTS,
      description: 'Per-IP rate limit exceeded.',
      schema: problemDetailsSchema,
    }),
  );
}

export function SwaggerSubmitVideoVerification() {
  return applyDecorators(
    ApiOperation({
      summary: 'Submit video verification step (completes the form)',
      description:
        'Completes the enrollment form. No client payload — the server records the video storage reference (videoKey) from the upload flow (deferred). On success the enrollment transitions to PENDING_REVIEW with currentStep = COMPLETED.',
    }),
    ApiParam({
      name: 'publicId',
      type: 'string',
      format: 'uuid',
      description: 'The enrollment public identifier returned from verify.',
    }),
    ApiBody({
      schema: videoVerificationStepJsonSchema,
      description: 'Empty body — video upload and storage reference recording are deferred.',
    }),
    ApiOkResponse({
      description:
        'Form completed; enrollment moved to PENDING_REVIEW with currentStep = COMPLETED.',
      schema: stepSubmissionResponseSchema,
    }),
    ApiBadRequestResponse({
      description: 'Validation failed; served as RFC 9457 Problem Details.',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.CONFLICT,
      description: 'Step not allowed in current state. Served as RFC 9457 Problem Details.',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.GONE,
      description: 'Enrollment has expired. Served as RFC 9457 Problem Details.',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.NOT_FOUND,
      description: 'Enrollment not found (BOLA exposure — auth deferred).',
      schema: problemDetailsSchema,
    }),
    ApiResponse({
      status: HttpStatus.TOO_MANY_REQUESTS,
      description: 'Per-IP rate limit exceeded.',
      schema: problemDetailsSchema,
    }),
  );
}
