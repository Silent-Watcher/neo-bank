import { HttpStatus } from '@nestjs/common';
import type { I18nKey } from '@nestjs/i18n';

import type { ErrorCode } from './error.code.js';
import { problemTypeForErrorCode, titleForErrorCode } from './error.code.js';

// RFC 9457 Problem Details with the application's extension members. Shared by
// the global exception filter and the early Fastify request-id rejection so
// every standardized error uses exactly this contract.
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  timestamp: string;
  apiVersion: string;
  requestId: string;
  code: ErrorCode;
}

// Titles for statuses that carry no application-specific Problem Type
// (`about:blank`); the generic fallback keeps unknown statuses safe and stable.
const STATUS_TITLES: ReadonlyMap<number, string> = new Map([
  [HttpStatus.BAD_REQUEST, 'Bad Request'],
  [HttpStatus.UNAUTHORIZED, 'Unauthorized'],
  [HttpStatus.FORBIDDEN, 'Forbidden'],
  [HttpStatus.NOT_FOUND, 'Not Found'],
  [HttpStatus.METHOD_NOT_ALLOWED, 'Method Not Allowed'],
  [HttpStatus.NOT_ACCEPTABLE, 'Not Acceptable'],
  [HttpStatus.CONFLICT, 'Conflict'],
  [HttpStatus.GONE, 'Gone'],
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE, 'Unsupported Media Type'],
  [HttpStatus.UNPROCESSABLE_ENTITY, 'Unprocessable Entity'],
  [HttpStatus.TOO_MANY_REQUESTS, 'Too Many Requests'],
  [HttpStatus.INTERNAL_SERVER_ERROR, 'Internal Server Error'],
  [HttpStatus.BAD_GATEWAY, 'Bad Gateway'],
  [HttpStatus.SERVICE_UNAVAILABLE, 'Service Unavailable'],
  [HttpStatus.GATEWAY_TIMEOUT, 'Gateway Timeout'],
]);

function titleForStatus(status: number): string {
  return STATUS_TITLES.get(status) ?? `HTTP ${status}`;
}

// Catalog keys for the translated status titles (ADR-021); the unknown-status
// fallback carries the status number as the `{status}` placeholder. The
// exception filter replaces the English title built above with the message
// for the request's locale.
const STATUS_TITLE_KEYS: ReadonlyMap<number, I18nKey> = new Map([
  [HttpStatus.BAD_REQUEST, 'errors.status.badRequest'],
  [HttpStatus.UNAUTHORIZED, 'errors.status.unauthorized'],
  [HttpStatus.FORBIDDEN, 'errors.status.forbidden'],
  [HttpStatus.NOT_FOUND, 'errors.status.notFound'],
  [HttpStatus.METHOD_NOT_ALLOWED, 'errors.status.methodNotAllowed'],
  [HttpStatus.NOT_ACCEPTABLE, 'errors.status.notAcceptable'],
  [HttpStatus.CONFLICT, 'errors.status.conflict'],
  [HttpStatus.GONE, 'errors.status.gone'],
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE, 'errors.status.unsupportedMediaType'],
  [HttpStatus.UNPROCESSABLE_ENTITY, 'errors.status.unprocessableEntity'],
  [HttpStatus.TOO_MANY_REQUESTS, 'errors.status.tooManyRequests'],
  [HttpStatus.INTERNAL_SERVER_ERROR, 'errors.status.internalServerError'],
  [HttpStatus.BAD_GATEWAY, 'errors.status.badGateway'],
  [HttpStatus.SERVICE_UNAVAILABLE, 'errors.status.serviceUnavailable'],
  [HttpStatus.GATEWAY_TIMEOUT, 'errors.status.gatewayTimeout'],
]);

export const UNKNOWN_STATUS_TITLE_KEY: I18nKey = 'errors.status.http';

export function titleKeyForStatus(status: number): I18nKey {
  return STATUS_TITLE_KEYS.get(status) ?? UNKNOWN_STATUS_TITLE_KEY;
}

export function buildProblemDetails(params: {
  status: number;
  code: ErrorCode;
  detail: string;
  requestId: string;
  apiVersion: string;
}): ProblemDetails {
  const { status, code, detail, requestId, apiVersion } = params;
  const type = problemTypeForErrorCode(code);

  return {
    type: type ?? 'about:blank',
    title: (type ? titleForErrorCode(code) : undefined) ?? titleForStatus(status),
    status,
    detail,
    timestamp: new Date().toISOString(),
    apiVersion,
    requestId,
    code,
  };
}
