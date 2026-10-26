import { HttpStatus, Injectable, StreamableFile } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { SSE_METADATA } from '@nestjs/common/constants.js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { map } from 'rxjs';
import type { Observable } from 'rxjs';

import { resolveApiVersion } from '../http/api-version.js';

const SUCCESS_MESSAGE = 'Success';
const NO_BODY_STATUSES = new Set<number>([HttpStatus.NO_CONTENT, HttpStatus.NOT_MODIFIED]);

function isJsonContentType(contentType: unknown): boolean {
  return typeof contentType === 'string' && contentType.toLowerCase().includes('json');
}

// Wraps ordinary successful JSON responses in the standardized envelope.
// Responses that do not produce a JSON body — no-content/not-modified, HEAD,
// streams and raw replies, file downloads, SSE handlers, and routes that set
// their own non-JSON content type (e.g. the Problem Type docs endpoint) — pass
// through untouched.
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    if (this.shouldSkip(request, reply, context)) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => {
        // A handler may finish the reply itself (raw reply usage, streams) or
        // produce a non-serializable payload; none of these get wrapped.
        if (reply.sent || data === undefined || data instanceof StreamableFile) {
          return data;
        }

        return {
          timestamp: new Date().toISOString(),
          apiVersion: resolveApiVersion(request.url),
          requestId: String(request.id),
          status: reply.statusCode,
          message: SUCCESS_MESSAGE,
          data,
        };
      }),
    );
  }

  private shouldSkip(
    request: FastifyRequest,
    reply: FastifyReply,
    context: ExecutionContext,
  ): boolean {
    if (request.method === 'HEAD') return true;
    if (NO_BODY_STATUSES.has(reply.statusCode)) return true;
    // @Sse() handlers stream a plain-text/event stream; wrapping would corrupt it.
    if (Reflect.getMetadata(SSE_METADATA, context.getHandler()) === true) return true;
    // A route that set an explicit non-JSON content type (e.g. text/html for
    // the Problem Type docs) controls its own representation.
    const contentType = reply.getHeader('content-type');
    if (contentType !== undefined && !isJsonContentType(contentType)) return true;

    return false;
  }
}
