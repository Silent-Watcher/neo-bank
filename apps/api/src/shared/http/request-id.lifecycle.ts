import { HttpStatus } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

import { ErrorCode } from '#errors/error.code.js';
import { buildProblemDetails } from '#errors/problem-details.js';
import { resolveApiVersion } from './api-version.js';
import type { HttpRequestLike, HttpResponseLike } from './http-boundary.js';

import {
  X_REQUEST_ID_HEADER,
  isValidUuidV4,
  readInboundRequestIdHeader,
  resolveRequestId,
} from './request-id.js';

// The minimal HTTP-adapter surface this lifecycle registers on, expressed
// structurally (ADR-032): the request-ID hook must run before routing and
// middleware on every request, which the NodeAdapter's request hook
// guarantees. The adapter's request/response types satisfy the hook's
// parameter contracts structurally.
export interface RequestIdLifecycleAdapter {
  setOnRequestHook(
    hook: (req: HttpRequestLike, res: HttpResponseLike, done: (err?: Error) => void) => void,
  ): void;
}

// Registers the request-ID lifecycle on the HTTP adapter:
// - every request gets an ID assigned (valid inbound UUIDv4 normalized to
//   lowercase, otherwise a fresh server-side UUIDv4) before any middleware or
//   route handler runs, and every response echoes it;
// - a present-but-invalid `x-request-id` header is rejected with `400` in the
//   standardized Problem Details contract before any route handler runs. The
//   freshly assigned server-side UUIDv4 is used everywhere; the invalid value
//   is never echoed, trusted, or logged.
// Responding without calling `done()` stops the request pipeline: the
// rejection never reaches a route handler.
export function registerRequestIdLifecycle(
  adapter: RequestIdLifecycleAdapter,
  logger: Logger,
): void {
  adapter.setOnRequestHook((req, res, done) => {
    const requestId = resolveRequestId(req);
    req.id = requestId;
    res.header(X_REQUEST_ID_HEADER, requestId);

    // Presence is checked on the raw header so that an unusable multi-value
    // header (duplicate header lines surface as an array) rejects exactly
    // like the comma-joined form, instead of silently resolving to absence.
    const header = req.headers[X_REQUEST_ID_HEADER];
    const value = readInboundRequestIdHeader(req);

    if (header === undefined || isValidUuidV4(value)) {
      done();
      return;
    }

    const problem = buildProblemDetails({
      status: HttpStatus.BAD_REQUEST,
      code: ErrorCode.InvalidRequestId,
      // This hook runs before the i18n middleware resolves a locale, so the
      // message stays English by design (ADR-021). Clients identify it by the
      // stable `code`, not the detail.
      detail: `${X_REQUEST_ID_HEADER} header must be a valid UUIDv4.`,
      requestId,
      apiVersion: resolveApiVersion(req.url ?? ''),
    });

    logger.warn(
      `Rejected invalid ${X_REQUEST_ID_HEADER} header; assigned request ID ${problem.requestId}.`,
    );

    // No entity tag on this response, unlike the other Problem Details paths:
    // the body embeds the client-supplied (validated, normalized) inbound
    // request ID, and a tag whose input a client can influence — for a
    // validator that can never revalidate anyway (fresh timestamp per
    // response) — is pure exposure with no caching value (Wave 25 SEC-04).
    res.status(problem.status).header('content-type', 'application/problem+json').send(problem);
  });
}
