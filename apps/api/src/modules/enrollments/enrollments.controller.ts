import { Body, Controller, Post } from '@nestjs/common';

import { ZodValidationPipe } from '#src/shared/pipes/zod-validation.pipe.js';

import { requestOtpSchema } from './enrollments.schema.js';
import type { RequestOtpBody } from './enrollments.schema.js';
import { EnrollmentsService } from './enrollments.service.js';

@Controller('enrollments')
export class EnrollmentsController {
  constructor(private readonly enrollmentsService: EnrollmentsService) {}

  @Post('otp')
  requestOtp(@Body(new ZodValidationPipe(requestOtpSchema)) body: RequestOtpBody) {
    return this.enrollmentsService.requestOtp(body.phoneNumber);
  }
}
