import { HEADERS_METADATA } from '@nestjs/common/constants.js';

import { isRecord } from './http-boundary.js';
import type { HttpResponseLike } from './http-boundary.js';

// Shared JSON-representation helpers for the global response interceptors:
// both the response envelope and the conditional-request tagging apply to the
// API's JSON representations only — a route that controls its own non-JSON
// body (declared via @Header, or set on the reply directly) bypasses both.

export function isJsonContentType(contentType: unknown): boolean {
  if (typeof contentType !== 'string') return false;
  // Only the JSON structured-syntax forms count: the media type itself (the
  // part before any parameters) must be `application/json` or end in `+json`.
  // A loose substring match would classify unrelated types like
  // `application/x-ndjson` as JSON and wrap/tag them (Wave 25 SEC-02).
  const mediaType = contentType.split(';')[0].trim().toLowerCase();
  return mediaType === 'application/json' || mediaType.endsWith('+json');
}

// @Header()-declared headers are applied by the router after the interceptor
// pipeline, so the reply header cannot be observed in time; the route's own
// metadata is the only way to see a declared content type during the pipeline.
export function declaredContentType(handler: object): string | undefined {
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

/**
 * Whether the route controls its own non-JSON representation — a declared
 * non-JSON content type, or one already set on the reply (raw reply usage).
 * Such responses bypass the JSON pipeline, so neither the envelope nor the
 * conditional-request tag applies.
 */
export function isNonJsonRepresentation(handler: object, reply: HttpResponseLike): boolean {
  const declared = declaredContentType(handler);
  if (declared !== undefined && !isJsonContentType(declared)) return true;

  const replyContentType = reply.getHeader('content-type');
  return replyContentType !== undefined && !isJsonContentType(replyContentType);
}
