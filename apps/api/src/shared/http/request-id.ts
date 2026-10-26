import { randomUUID } from 'node:crypto';

export const X_REQUEST_ID_HEADER = 'x-request-id';

// Full UUID structure including the v4 version nibble and the RFC 4122
// variant nibble, so only genuine UUIDv4 values are accepted.
// info: this regex only accepts lowercase version
// const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuidV4(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4_PATTERN.test(value);
}

export interface FastifyRequestLike {
  headers: Record<string, string | string[] | undefined>;
}

// Fastify's single source of truth for request IDs (`genReqId` adapter
// option). A valid inbound UUIDv4 is normalized to lowercase and reused;
// anything else — absent, malformed, another version, or multiple values —
// falls back to a fresh server-generated UUIDv4 so an invalid value is never
// trusted or echoed.
export function fastifyGenReqId(req: FastifyRequestLike): string {
  const header = req.headers[X_REQUEST_ID_HEADER];
  // A repeated header that cannot be represented as a single value is invalid;
  // the comma-joined raw form fails the UUIDv4 check below either way.
  const value = Array.isArray(header) ? (header.length === 1 ? header[0] : undefined) : header;

  return isValidUuidV4(value) ? value.toLowerCase() : randomUUID();
}
