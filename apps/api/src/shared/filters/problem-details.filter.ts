import { Catch, HttpException, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PinoLogger } from 'nestjs-pino';

import { AppHttpException } from '../errors/app-http.exception.js';
import { ErrorCode, errorCodeForStatus } from '../errors/error.code.js';
import { buildProblemDetails } from '../errors/problem-details.js';
import { resolveApiVersion } from '../http/api-version.js';
import { X_REQUEST_ID_HEADER } from '../http/request-id.js';

const GENERIC_SERVER_ERROR_DETAIL = 'An unexpected error occurred.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function detailFromHttpException(exception: HttpException): string {
  const response = exception.getResponse();

  if (typeof response === 'string') {
    return response;
  }
  if (isRecord(response)) {
    if (typeof response.detail === 'string') return response.detail;
    if (typeof response.message === 'string') return response.message;
    if (Array.isArray(response.message)) {
      // Validation message arrays are joined so the list stays readable
      // without leaking the raw exception structure.
      return response.message.filter((item) => typeof item === 'string').join('; ');
    }
  }

  // Built-in exception messages are framework phrases and safe to expose.
  return exception.message;
}

interface NormalizedException {
  status: number;
  code: ErrorCode;
  detail: string;
  error?: Error;
}

// Normalizes every escaped exception into the RFC 9457 Problem Details
// contract. Built-in NestJS HTTP exceptions keep working as before and get a
// centralized status-based code; unknown exceptions become a safe generic 500.
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  // PinoLogger forwards arguments to Pino verbatim and carries the
  // request-scoped context, so error records keep the current request ID.
  constructor(private readonly logger: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    const normalized = this.normalize(exception);
    const problem = buildProblemDetails({
      status: normalized.status,
      code: normalized.code,
      detail: normalized.detail,
      requestId: String(request.id),
      apiVersion: resolveApiVersion(request.url),
    });

    reply
      .status(normalized.status)
      .header('content-type', 'application/problem+json')
      .header(X_REQUEST_ID_HEADER, problem.requestId)
      .send(problem);

    if (normalized.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // Unexpected server errors carry the original exception and stack for
      // diagnostics; expected client errors are logged at warn without them.
      this.logger.error({ err: normalized.error }, 'Unhandled exception');
    } else {
      this.logger.warn(`HTTP ${normalized.status} ${normalized.code}`);
    }
  }

  private normalize(exception: unknown): NormalizedException {
    if (exception instanceof AppHttpException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        detail: detailFromHttpException(exception),
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();

      return {
        status,
        code: errorCodeForStatus(status),
        detail: detailFromHttpException(exception),
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.ApplicationError,
      detail: GENERIC_SERVER_ERROR_DETAIL,
      error: exception instanceof Error ? exception : undefined,
    };
  }
}
