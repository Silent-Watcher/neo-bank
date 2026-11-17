import { Catch, HttpException, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { I18nContext, I18nService } from '@nestjs/i18n';
import { PinoLogger } from 'nestjs-pino';
import { ThrottlerException } from '@nestjs/throttler';

import { AppHttpException } from '#errors/app-http.exception.js';
import { ErrorCode, errorCodeForStatus, titleKeyForErrorCode } from '#errors/error.code.js';
import { buildProblemDetails, titleKeyForStatus } from '#errors/problem-details.js';
import type { HttpRequestLike, HttpResponseLike } from '#http/http-boundary.js';
import { isRecord } from '#http/http-boundary.js';
import { resolveApiVersion } from '#http/api-version.js';
import { weakEtagFor } from '#http/etag.js';
import { X_REQUEST_ID_HEADER } from '#http/request-id.js';

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
      // without leaking the raw exception structure; an array with no string
      // members falls through to the built-in message like any other shape.
      const details = response.message.filter(
        (item: unknown): item is string => typeof item === 'string',
      );
      if (details.length > 0) return details.join('; ');
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

// Normalizes a (framework or application) HTTP exception into the status/code/
// detail triple the Problem Details contract carries. Shared with the
// bootstrap's root-level not-found fallback so both paths build the same body
// (ADR-032).
export function normalizeHttpException(exception: unknown, i18n: I18nService): NormalizedException {
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
      detail: i18n.t('errors.details.rateLimited'),
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
    detail: i18n.t('errors.details.unexpected'),
    // Non-Error thrown values carry no safe diagnostics, but the failure
    // must still surface at error level, so the type is wrapped as the
    // cause. The thrown value itself is never logged or echoed.
    error:
      exception instanceof Error
        ? exception
        : new Error(`Non-Error value thrown (${typeof exception})`),
  };
}

// The Problem Details `title` is built in English by buildProblemDetails and
// localized here for the request's locale. `code`, `status`, `type` stay
// machine-readable (ADR-021).
export function localizedProblemTitle(i18n: I18nService, code: ErrorCode, status: number): string {
  const key = titleKeyForErrorCode(code) ?? titleKeyForStatus(status);
  return i18n.t(key, { args: { status } });
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
    private readonly i18nContext: I18nContext,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<HttpRequestLike>();
    const reply = http.getResponse<HttpResponseLike>();

    const normalized = normalizeHttpException(exception, this.i18n);

    // A response that is already committed (an @Sse() stream erroring after
    // its headers went out, or a raw reply that sent and then threw) cannot
    // carry Problem Details: a second send would throw ERR_HTTP_HEADERS_SENT
    // out of the filter and destroy the connection. The diagnostic logging
    // below still runs — the failure is never silently lost.
    if (reply.headersSent || reply.writableEnded) {
      if (normalized.status >= HttpStatus.INTERNAL_SERVER_ERROR && normalized.error !== undefined) {
        this.logger.error({ err: normalized.error }, 'Unhandled exception (response already sent)');
      } else {
        this.logger.warn(`HTTP ${normalized.status} ${normalized.code} (response already sent)`);
      }
      return;
    }

    const problem = buildProblemDetails({
      status: normalized.status,
      code: normalized.code,
      detail: normalized.detail,
      requestId: String(request.id),
      apiVersion: resolveApiVersion(request.url ?? ''),
    });
    // `detail` is already localized at its throw site (service, pipe); the
    // title is built in English by buildProblemDetails (also consumed by the
    // pre-i18n request-id rejection) and localized here for the request's
    // locale. `code`, `status`, `type` stay machine-readable (ADR-021).
    problem.title = localizedProblemTitle(this.i18n, normalized.code, normalized.status);

    // Conditional-request support (ADR-032, ADR-038): Problem Details bodies
    // carry an entity tag like every other JSON response. The tag never
    // revalidates — the body embeds a fresh timestamp and request ID per
    // response — so the header is set without any If-None-Match processing.
    // The title is localized per request, so the locale composes into the
    // hash: the en/fa problem bodies are distinct representations.
    reply.header('ETag', weakEtagFor(JSON.stringify(problem), this.i18nContext.locale));

    reply
      .status(normalized.status)
      .header('content-type', 'application/problem+json')
      .header(X_REQUEST_ID_HEADER, problem.requestId)
      .send(problem);

    if (normalized.status >= HttpStatus.INTERNAL_SERVER_ERROR && normalized.error !== undefined) {
      // Unexpected server errors carry the original exception and stack for
      // diagnostics; deliberate bare 5xx exceptions (e.g. load-shedding 503s,
      // readiness failures — no attached error) are expected outcomes and log
      // at warn so they cannot drown real incidents at error level.
      this.logger.error({ err: normalized.error }, 'Unhandled exception');
    } else {
      this.logger.warn(`HTTP ${normalized.status} ${normalized.code}`);
    }
  }
}
