import { HttpStatus, Injectable, StreamableFile } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { SSE_METADATA } from '@nestjs/common/constants.js';
import { I18nService } from '@nestjs/i18n';
import { map } from 'rxjs';
import type { Observable } from 'rxjs';

import { resolveApiVersion } from '#http/api-version.js';
import type { HttpRequestLike, HttpResponseLike } from '#http/http-boundary.js';
import { isNonJsonRepresentation } from '#http/json-content-type.js';

const NO_BODY_STATUSES = new Set<number>([HttpStatus.NO_CONTENT, HttpStatus.NOT_MODIFIED]);

// Wraps ordinary successful JSON responses in the standardized envelope.
// Responses that do not produce a JSON body — no-content/not-modified, HEAD,
// streams and raw replies, file downloads, SSE handlers, and routes that set
// their own non-JSON content type (e.g. the Problem Type docs endpoint) — pass
// through untouched.
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly i18n: I18nService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<HttpRequestLike>();
    const reply = http.getResponse<HttpResponseLike>();

    if (this.shouldSkip(request, reply, context)) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data: unknown) => {
        // A handler may finish or start the response itself (raw response
        // usage, streaming), set a non-JSON content type mid-execution (the
        // eager skip above ran before the handler and could not see it), or
        // produce a payload with no JSON representation; none of these get
        // wrapped.
        if (
          reply.writableEnded ||
          reply.headersSent ||
          data === undefined ||
          data instanceof StreamableFile ||
          ArrayBuffer.isView(data) ||
          isNonJsonRepresentation(context.getHandler(), reply)
        ) {
          return data;
        }

        return {
          timestamp: new Date().toISOString(),
          apiVersion: resolveApiVersion(request.url ?? ''),
          requestId: String(request.id),
          status: reply.statusCode,
          // Only the human-readable envelope message is localized; `data`
          // and every machine-readable member pass through untouched.
          message: this.i18n.t('common.success'),
          data,
        };
      }),
    );
  }

  private shouldSkip(
    request: HttpRequestLike,
    reply: HttpResponseLike,
    context: ExecutionContext,
  ): boolean {
    if (request.method === 'HEAD') return true;
    if (NO_BODY_STATUSES.has(reply.statusCode)) return true;
    // @Sse() handlers stream a plain-text/event stream; wrapping would corrupt it.
    if (Reflect.getMetadata(SSE_METADATA, context.getHandler()) === true) return true;
    // A route that declares its own non-JSON content type (via @Header, e.g.
    // text/html for the Problem Type docs), or that already wrote a non-JSON
    // content type onto the reply (raw reply usage), controls its own
    // representation.
    if (isNonJsonRepresentation(context.getHandler(), reply)) return true;

    return false;
  }
}
