import { HttpStatus } from '@nestjs/common';
import type { FastifyInstance } from 'fastify';
import { Logger } from 'nestjs-pino';

import { ErrorCode } from '#errors/error.code.js';
import { buildProblemDetails } from '#errors/problem-details.js';
import { resolveApiVersion } from './api-version.js';
import { X_REQUEST_ID_HEADER, isValidUuidV4 } from './request-id.js';

// Registers the request-ID lifecycle on the raw Fastify instance:
// - every response carries the request ID from Fastify's own lifecycle;
// - a present-but-invalid `x-request-id` header is rejected with `400` in the
//   standardized Problem Details contract before any route handler runs. The
//   ID already assigned by `genReqId` (a fresh server-side UUIDv4) is used
//   everywhere; the invalid value is never echoed, trusted, or logged.
export function registerRequestIdLifecycle(instance: FastifyInstance, logger: Logger): void {
  instance.addHook('onRequest', async (request, reply) => {
    reply.header(X_REQUEST_ID_HEADER, String(request.id));

    const header = request.headers[X_REQUEST_ID_HEADER];
    const value = Array.isArray(header) ? (header.length === 1 ? header[0] : undefined) : header;

    if (header === undefined || isValidUuidV4(value)) {
      return;
    }

    const problem = buildProblemDetails({
      status: HttpStatus.BAD_REQUEST,
      code: ErrorCode.InvalidRequestId,
      detail: `${X_REQUEST_ID_HEADER} header must be a valid UUIDv4.`,
      requestId: String(request.id),
      apiVersion: resolveApiVersion(request.url),
    });

    logger.warn(
      `Rejected invalid ${X_REQUEST_ID_HEADER} header; assigned request ID ${problem.requestId}.`,
    );

    await reply
      .status(problem.status)
      .header('content-type', 'application/problem+json')
      .send(problem);
  });
}
