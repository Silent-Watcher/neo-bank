import { HttpStatus, Injectable, StreamableFile } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { SSE_METADATA } from '@nestjs/common/constants.js';
import { I18nContext } from '@nestjs/i18n';
import { map } from 'rxjs';
import type { Observable } from 'rxjs';

import type { HttpRequestLike, HttpResponseLike } from './http-boundary.js';
import { ifNoneMatchSatisfied, weakEtagFor } from './etag.js';
import { isNonJsonRepresentation } from './json-content-type.js';

// Exclusive upper bound of the successful (2xx) status class: only a
// successful response has a selected representation a validator can identify
// (ADR-038 §2). The installed HttpStatus enum names 300 `AMBIGUOUS` and has
// no `MULTIPLE_CHOICES` member, so the 3xx boundary is written explicitly.
const SUCCESS_STATUSES_MAX_EXCLUSIVE = 300;

/**
 * Conditional-request support for JSON responses (ADR-032; reworked by
 * ADR-038): every response with a JSON representation carries a weak entity
 * tag computed over the application payload and the request's resolved
 * locale (the envelope message is localized, so the en/fa variants are
 * distinct representations), and a GET/HEAD request whose `If-None-Match`
 * matches is answered with `304` — the adapter strips Content-Type and ends
 * 304s without the payload natively, so the interceptor only sets the status
 * and lets the pipeline finish (no second send).
 *
 * Revalidation is gated to successful (2xx) selected representations: a
 * route answering with an error status is never revalidated to 304, because
 * an error response has no representation a validator could identify
 * (ADR-038 §2).
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
 * Problem Details filter tags error responses with the same locale-composed
 * `weakEtagFor` (no revalidation — fresh timestamp per response).
 */
@Injectable()
export class ConditionalRequestInterceptor implements NestInterceptor {
  // I18nContext is the module's exported per-request locale view: its
  // `locale` getter reads the request's AsyncLocalStorage store (or falls
  // back to the default locale outside a request).
  constructor(private readonly i18nContext: I18nContext) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<HttpRequestLike>();
    const response = http.getResponse<HttpResponseLike>();

    return next.handle().pipe(
      map((data: unknown) => {
        // Nothing to tag: SSE streams are not a single JSON representation,
        // streams, or a response already written, and a route that controls
        // its own non-JSON representation (declared or reply-set non-JSON
        // content type) bypasses the JSON pipeline whose payload the tag
        // would validate. HEAD hashes the same handler payload as GET, so
        // its validator matches the GET representation's tag and HEAD
        // revalidation works (RFC 9110 §9.3.2).
        if (
          Reflect.getMetadata(SSE_METADATA, context.getHandler()) === true ||
          data instanceof StreamableFile ||
          ArrayBuffer.isView(data) ||
          response.writableEnded ||
          response.headersSent ||
          isNonJsonRepresentation(context.getHandler(), response)
        ) {
          return data;
        }

        const serialized = JSON.stringify(data);
        // A payload with no JSON representation (a function or a symbol) can
        // neither be enveloped nor tagged; leave it untouched.
        if (serialized === undefined) {
          return data;
        }

        const etag = weakEtagFor(serialized, this.i18nContext.locale);
        response.header('ETag', etag);

        // Revalidation applies to GET and HEAD only (as with Fastify), and
        // only to successful selected representations: other methods keep
        // their full response even with a matching candidate, and an
        // error-status route is never answered with 304.
        if (
          (request.method === 'GET' || request.method === 'HEAD') &&
          response.statusCode >= HttpStatus.OK &&
          response.statusCode < SUCCESS_STATUSES_MAX_EXCLUSIVE &&
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
