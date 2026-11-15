import { HttpStatus, Injectable, StreamableFile } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { HEADERS_METADATA, SSE_METADATA } from '@nestjs/common/constants.js';
import { I18nService } from '@nestjs/i18n';
import { map } from 'rxjs';
import type { Observable } from 'rxjs';

import { resolveApiVersion } from '#http/api-version.js';
import { isRecord } from '#http/http-boundary.js';
import type { HttpRequestLike, HttpResponseLike } from '#http/http-boundary.js';

const NO_BODY_STATUSES = new Set<number>([HttpStatus.NO_CONTENT, HttpStatus.NOT_MODIFIED]);

function isJsonContentType(contentType: unknown): boolean {
  return typeof contentType === 'string' && contentType.toLowerCase().includes('json');
}

// @Header()-declared headers are applied by the router after the interceptor
// pipeline, so the reply header cannot be observed here; the route's own
// metadata is the only way to see a declared content type in time.
function declaredContentType(handler: object): string | undefined {
  const headers: unknown = Reflect.getMetadata(HEADERS_METADATA, handler);

  if (!Array.isArray(headers)) return undefined;
  // Array.isArray on `unknown` narrows to any[]; the explicit unknown[] keeps
  // the loop typed and lets isRecord() narrow each entry properly.
  const headerList: unknown[] = headers;
  for (const header of headerList) {
    if (!isRecord(header)) continue;
    if (typeof header.name !== 'string' || header.name.toLowerCase() !== 'content-type') continue;
    if (typeof header.value === 'string') return header.value;
  }

  return undefined;
}

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
        // usage, streaming) or produce a non-serializable payload; none of
        // these get wrapped.
        if (
          reply.writableEnded ||
          reply.headersSent ||
          data === undefined ||
          data instanceof StreamableFile
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
    // text/html for the Problem Type docs) controls its own representation.
    const contentType = declaredContentType(context.getHandler());
    if (contentType !== undefined && !isJsonContentType(contentType)) return true;
    // A handler that already wrote a non-JSON content type onto the reply
    // (e.g. raw reply usage) controls its own representation too.
    const replyContentType = reply.getHeader('content-type');
    if (replyContentType !== undefined && !isJsonContentType(replyContentType)) return true;

    return false;
  }
}
