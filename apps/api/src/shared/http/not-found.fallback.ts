import { NotFoundException } from '@nestjs/common';
import { I18nContext, I18nService } from '@nestjs/i18n';

import { buildProblemDetails } from '#errors/problem-details.js';
import { localizedProblemTitle, normalizeHttpException } from '#filters/problem-details.filter.js';
import { resolveApiVersion } from './api-version.js';
import type { HttpRequestLike, HttpResponseLike } from './http-boundary.js';
import { weakEtagFor } from './etag.js';
import { isValidUuidV4, resolveRequestId, X_REQUEST_ID_HEADER } from './request-id.js';

// The minimal HTTP-adapter surface this fallback registers on, expressed
// structurally (ADR-032). The second registration with an empty prefix mounts
// the handler for unmatched paths outside every registered prefix, behind the
// routes and the prefix-scoped not-found mount, so it must be called after
// the application is initialized (registering before init would shadow the
// excluded root-level routes such as the health probes).
export interface RootNotFoundAdapter {
  setNotFoundHandler(
    handler: (req: HttpRequestLike, res: HttpResponseLike, next: (err?: unknown) => void) => void,
    prefix: string,
  ): void;
}

// Registers a root-level not-found fallback (ADR-032): Nest core only mounts
// its not-found handler under the global prefix, so unmatched paths outside
// it (e.g. GET /healthz) would otherwise receive the adapter's plain-text 404
// instead of the Problem Details contract. Responds directly through the same
// shared building blocks the Problem Details filter uses, so both 404 paths
// produce the identical body. The pino-http access log already records every
// request, so no additional log line is emitted here.
export function registerRootNotFoundFallback(
  adapter: RootNotFoundAdapter,
  i18n: I18nService,
  i18nContext: I18nContext,
): void {
  adapter.setNotFoundHandler((req, res, _next) => {
    // A future raw handler that already started the response must win; a
    // second send would throw. Aligned with the Problem Details filter's
    // committed-response guard (Wave 25 CR-02 / SEC-03).
    if (res.headersSent || res.writableEnded) {
      return;
    }
    const notFound = new NotFoundException(`Cannot ${req.method ?? 'GET'} ${req.url ?? '/'}`);
    const normalized = normalizeHttpException(notFound, i18n);
    // The request-ID lifecycle assigns req.id before routing, so the
    // lifecycle-assigned ID is used directly; resolve defensively so a
    // bootstrap that registered this fallback without the lifecycle still
    // gets a real UUIDv4 instead of the literal "undefined".
    const requestId = isValidUuidV4(req.id) ? req.id : resolveRequestId(req);
    const problem = buildProblemDetails({
      status: normalized.status,
      code: normalized.code,
      detail: normalized.detail,
      requestId,
      apiVersion: resolveApiVersion(req.url ?? ''),
    });
    problem.title = localizedProblemTitle(i18n, normalized.code, normalized.status);

    // ETag like every other Problem Details response (ADR-032, ADR-038). This
    // handler bypasses the interceptor pipeline and the filter, so the tag is
    // set here; the fresh per-request timestamp means it never revalidates.
    // The title is localized per request, so the locale composes into the
    // hash: the en/fa problem bodies are distinct representations.
    res
      .status(problem.status)
      .header('ETag', weakEtagFor(JSON.stringify(problem), i18nContext.locale))
      .header('content-type', 'application/problem+json')
      .header(X_REQUEST_ID_HEADER, problem.requestId)
      .send(problem);
  }, '');
}
