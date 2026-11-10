import { Catch, HttpException, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { I18nService } from '@nestjs/i18n';
import { PinoLogger } from 'nestjs-pino';
import { ThrottlerException } from '@nestjs/throttler';

import { AppHttpException } from '#errors/app-http.exception.js';
import { ErrorCode, errorCodeForStatus, titleKeyForErrorCode } from '#errors/error.code.js';
import { buildProblemDetails, titleKeyForStatus } from '#errors/problem-details.js';
import { resolveApiVersion } from '#http/api-version.js';
import { X_REQUEST_ID_HEADER } from '#http/request-id.js';

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
  constructor(
    private readonly logger: PinoLogger,
    private readonly i18n: I18nService,
  ) {}

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
    // `detail` is already localized at its throw site (service, pipe); the
    // title is built in English by buildProblemDetails (also consumed by the
    // pre-i18n request-id rejection) and localized here for the request's
    // locale. `code`, `status`, `type` stay machine-readable (ADR-021).
    problem.title = this.localizedTitle(normalized.code, normalized.status);

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

  private localizedTitle(code: ErrorCode, status: number): string {
    const key = titleKeyForErrorCode(code) ?? titleKeyForStatus(status);
    return this.i18n.t(key, { args: { status } });
  }

  private normalize(exception: unknown): NormalizedException {
    if (exception instanceof AppHttpException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        detail: detailFromHttpException(exception),
      };
    }

    // Identified specifically (not via the status) so unrelated HTTP 429s
    // keep the generic status-based handling; the framework exception
    // message is replaced with a safe, predictable detail.
    if (exception instanceof ThrottlerException) {
      return {
        status: HttpStatus.TOO_MANY_REQUESTS,
        code: ErrorCode.RateLimited,
        detail: this.i18n.t('errors.details.rateLimited'),
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
      detail: this.i18n.t('errors.details.unexpected'),
      error: exception instanceof Error ? exception : undefined,
    };
  }
}
