import { HttpException, HttpStatus } from '@nestjs/common';

import type { ErrorCode } from './error.code.js';

// Application-specific HTTP exception carrying a typed error code. It stays
// inside the standard NestJS HTTP exception model, so the global filter
// normalizes it together with built-in HTTP exceptions.
export class AppHttpException extends HttpException {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, detail: string, status: HttpStatus) {
    super({ code, detail }, status);
    this.code = code;
  }
}
