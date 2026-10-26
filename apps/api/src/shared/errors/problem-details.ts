import { HttpStatus } from '@nestjs/common';

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
