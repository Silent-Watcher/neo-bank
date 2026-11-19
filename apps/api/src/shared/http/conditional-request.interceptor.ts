import { HttpStatus, Injectable, StreamableFile } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { SSE_METADATA } from '@nestjs/common/constants.js';
import { I18nContext } from '@nestjs/i18n';
import { map } from 'rxjs';
import type { Observable } from 'rxjs';

import type { HttpRequestLike, HttpResponseLike } from './http-boundary.js';
import { weakEtagFor } from './etag.js';
import { CONDITIONAL_GET_METADATA } from './conditional-get.decorator.js';
import { isNonJsonRepresentation } from './json-content-type.js';
import { ifNoneMatchSatisfied } from './if-none-match.js';

// Exclusive upper bound of the successful (2xx) status class: only a
// successful response has a selected representation a validator can identify
// (ADR-038 §2). The installed HttpStatus enum names 300 `AMBIGUOUS` and has
// no `MULTIPLE_CHOICES` member, so the 3xx boundary is written explicitly.
const SUCCESS_STATUSES_MAX_EXCLUSIVE = HttpStatus.AMBIGUOUS;

// Cache directives for revalidatable responses (Wave 25/26 SEC-04, RFC 9110
// §15.4.5): `private` keeps shared intermediaries from storing the response
// at all, and `no-cache` makes every private-cache reuse conditional on a
// successful revalidation — the exact semantics the entity tag exists for.
// Set before the 304 decision so the 304 echoes it; an explicitly declared
// header (e.g. the health routes' no-store) is never overwritten.
const REVALIDATABLE_CACHE_CONTROL = 'private, no-cache';

/**
 * Conditional-request support for JSON responses (ADR-032; reworked by
 * ADR-038): every response with a JSON representation carries a weak entity
 * tag computed over the application payload and the request's resolved
 * locale (the envelope message is localized, so the en/fa variants are
 * distinct representations), plus the revalidation cache directives.
 *
 * Revalidation is opt-in (ADR-038 §3): a GET request whose `If-None-Match`
 * matches is answered with `304` only when the route opted in through the
 * `@ConditionalGet()` decorator, and only on a successful (2xx) response —
 * an error response has no representation a validator could identify
 * (ADR-038 §2). HEAD is excluded from revalidation (ADR-038 §7, developer
 * decision): HEAD responses carry the entity tag (RFC 9110 §9.3.2 metadata
 * mirroring) but are never answered with 304.
 *
 * A matched 304 is genuinely bodyless: nothing is serialized after the
 * decision, and the adapter strips Content-Type and ends the response
 * natively.
 *
 * Unlike the Fastify-era tags — strong tags over the full envelope, whose
 * fresh timestamp and per-request request ID changed the body on every
 * response, so revalidation could never succeed in practice — the weak
 * payload validator actually revalidates: "unchanged" means the same
 * application data, regardless of the envelope metadata.
 *
 * Scope notes: SSE routes are skipped (their stream is not a single JSON
 * representation); the pre-i18n request-ID rejection sends a Problem Details
 * body outside the interceptor pipeline (untagged — its body embeds the
 * client-supplied inbound request ID, Wave 25 SEC-04); the Problem Details
 * filter tags error responses with the same locale-composed `weakEtagFor`
 * (no revalidation — fresh timestamp per response).
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
        // its validator matches the GET representation's tag (RFC 9110
        // §9.3.2 metadata mirroring) — but HEAD never revalidates (§7).
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
        if (response.getHeader('cache-control') === undefined) {
          response.header('Cache-Control', REVALIDATABLE_CACHE_CONTROL);
        }

        // Revalidation is opt-in and GET-only (ADR-038 §3, §7), and applies
        // to successful selected representations only: undecorated routes,
        // other methods, and error-status responses keep their full response
        // even with a matching candidate.
        if (
          request.method === 'GET' &&
          Reflect.getMetadata(CONDITIONAL_GET_METADATA, context.getHandler()) === true &&
          response.statusCode >= HttpStatus.OK &&
          response.statusCode < SUCCESS_STATUSES_MAX_EXCLUSIVE &&
          ifNoneMatchSatisfied(request.headers['if-none-match'], etag)
        ) {
          // 304: the adapter strips Content-Type and ends the response
          // body-less natively. Nothing is serialized after the decision —
          // the payload is dropped here, so the response stays genuinely
          // bodyless end to end (ADR-038 §5).
          response.status(HttpStatus.NOT_MODIFIED);
          return undefined;
        }

        return data;
      }),
    );
  }
}
