import { Injectable, StreamableFile } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { SSE_METADATA } from '@nestjs/common/constants.js';
import { map } from 'rxjs';
import type { Observable } from 'rxjs';

import { isRecord } from './http-boundary.js';
import type { HttpRequestLike, HttpResponseLike } from './http-boundary.js';
import { ifNoneMatchSatisfied, weakEtag } from './etag.js';

/**
 * Conditional-request support for JSON responses (ADR-032, restoring the
 * Fastify-era behavior recorded in DEFERRED.md): every response with a
 * JSON-serializable payload carries a weak entity tag computed over the
 * application payload (the handler data before the response envelope adds
 * its per-response metadata), and a GET/HEAD request whose `If-None-Match`
 * matches is answered with `304` — the adapter strips Content-Type and
 * ends 304s without the payload natively, so the interceptor only sets the
 * status and lets the pipeline finish (no second send).
 *
 * Unlike the Fastify-era tags — strong tags over the full envelope, whose
 * fresh timestamp and per-request request ID changed the body on every
 * response, so revalidation could never succeed in practice — the weak
 * payload validator actually revalidates: "unchanged" means the same
 * application data, regardless of the envelope metadata.
 *
 * Scope notes: SSE routes are skipped (their stream is not a single JSON
 * representation); the pre-i18n request-ID rejection sends a Problem Details
 * body outside the interceptor pipeline (tagged by the lifecycle itself); the
 * Problem Details filter tags error responses with the same `weakEtag` (no
 * revalidation — fresh timestamp per response).
 */
@Injectable()
export class ConditionalRequestInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<HttpRequestLike>();
    const response = http.getResponse<HttpResponseLike>();

    return next.handle().pipe(
      map((data: unknown) => {
        // Nothing to tag: SSE streams are not a single JSON representation,
        // streams, or a response already written. HEAD hashes the same
        // handler payload as GET, so its validator matches the GET
        // representation's tag and HEAD revalidation works (RFC 9110 §9.3.2).
        if (
          Reflect.getMetadata(SSE_METADATA, context.getHandler()) === true ||
          !isRecord(data) ||
          data instanceof StreamableFile ||
          response.writableEnded ||
          response.headersSent
        ) {
          return data;
        }

        const etag = weakEtag(JSON.stringify(data));
        response.header('ETag', etag);

        // Revalidation applies to GET and HEAD only (as with Fastify): other
        // methods keep their full response even with a matching candidate.
        if (
          (request.method === 'GET' || request.method === 'HEAD') &&
          ifNoneMatchSatisfied(request.headers['if-none-match'], etag)
        ) {
          // 304: the adapter's 304 handling strips Content-Type and ends the
          // response without the payload; Node discards it natively.
          response.status(304);
        }

        return data;
      }),
    );
  }
}
