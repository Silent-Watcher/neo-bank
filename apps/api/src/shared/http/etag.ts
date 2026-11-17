import { createHash } from 'node:crypto';

// Conditional-request support (ADR-032 / DEFERRED.md): entity tags over the
// application payload (the handler data the response pipeline wraps), with
// If-None-Match handling that mirrors the prior Fastify behavior — ETag on
// every JSON-body response, 304 revalidation for GET/HEAD.

/**
 * The quoted entity tag for a serialized application payload. A WEAK
 * validator (`W/`) by design: the response envelope adds per-response
 * metadata (timestamp, request ID), so the tag validates the payload's
 * semantic equivalence, not byte-identity of the wire representation
 * (RFC 9110 §13.1.2 — If-None-Match compares weakly anyway).
 */
export function weakEtag(serializedPayload: string): string {
  return `W/"${createHash('sha256').update(serializedPayload).digest('hex')}"`;
}

/**
 * The quoted entity tag for a serialized representation and the request's
 * resolved locale. Bodies whose content varies per locale (the response
 * envelope's localized message, localized Problem Details titles) must not
 * share a validator: composing the locale into the hashed input keeps one
 * tag per selected representation. The `\n` separator is injective — JSON
 * serialization never ends with a newline and the locale comes from the
 * fixed, newline-free supported-locale allowlist — so distinct
 * (representation, locale) pairs never collide.
 */
export function weakEtagFor(serializedRepresentation: string, locale: string): string {
  return weakEtag(`${serializedRepresentation}\n${locale}`);
}

/**
 * Whether the request's `If-None-Match` header matches the entity tag: any
 * listed candidate matches after ignoring a weak validator prefix (`W/`),
 * and `*` matches any existing resource. `false` when the header is absent
 * or lists only other entity tags. Weak comparison, per RFC 9110 §13.1.2.
 */
export function ifNoneMatchSatisfied(headerValue: unknown, etag: string): boolean {
  if (typeof headerValue !== 'string' || headerValue.trim() === '') {
    return false;
  }

  // Weak comparison (RFC 9110 §13.1.2): compare the opaque values after
  // ignoring the weak prefix on both sides.
  const opaque = etag.replace(/^W\//, '');
  return headerValue.split(',').some((candidate) => {
    const tag = candidate.trim();
    if (tag === '*') return true;
    return tag.replace(/^W\//, '') === opaque;
  });
}
