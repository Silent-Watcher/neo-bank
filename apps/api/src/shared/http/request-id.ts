import { randomUUID } from 'node:crypto';

import type { HttpRequestLike } from './http-boundary.js';

export const X_REQUEST_ID_HEADER = 'x-request-id';

// Full UUID structure including the v4 version nibble and the RFC 4122
// variant nibble, so only genuine UUIDv4 values are accepted. Values are
// case-insensitive; an accepted value is normalized to lowercase before reuse.
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuidV4(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4_PATTERN.test(value);
}

// A repeated header that cannot be represented as a single value is invalid;
// the comma-joined raw form fails the UUIDv4 check of the caller either way.
export function readInboundRequestIdHeader(
  req: Pick<HttpRequestLike, 'headers'>,
): string | undefined {
  const header = req.headers[X_REQUEST_ID_HEADER];

  return Array.isArray(header) ? (header.length === 1 ? header[0] : undefined) : header;
}

// Single source of truth for request IDs. A valid inbound UUIDv4 is normalized
// to lowercase and reused; anything else — absent, malformed, another version,
// or multiple values — falls back to a fresh server-generated UUIDv4 so an
// invalid value is never trusted or echoed.
export function resolveRequestId(req: Pick<HttpRequestLike, 'headers'>): string {
  const value = readInboundRequestIdHeader(req);

  return isValidUuidV4(value) ? value.toLowerCase() : randomUUID();
}
