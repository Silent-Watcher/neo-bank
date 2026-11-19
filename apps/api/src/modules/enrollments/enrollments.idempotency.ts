import { HttpStatus } from '@nestjs/common';
import type { IdempotentOptions } from '@nestjs/idempotency';

import idempotencyConfig from '#config/idempotency.config.js';
import { isRecord } from '#http/http-boundary.js';

import { toNationalMobile } from './enrollments.schema.js';

// How long a completed challenge result stays replayable (ADR-039): the
// package default, chosen to exceed any plausible client retry window. It is
// deliberately decoupled from the OTP's 120-second validity — a replay is the
// same logical operation, not a new one. Named constants, not environment
// variables, until a concrete tuning requirement appears.
const CHALLENGE_IDEMPOTENCY_RECORD_TTL = '24h';

// How long an in-flight lock survives without renewal (the package renews it
// every lockTtl/3 while the handler runs; the endpoint completes in
// milliseconds).
const CHALLENGE_IDEMPOTENCY_LOCK_TTL = '60s';

// How long a client should wait after a 409 IDEMPOTENCY_KEY_IN_USE before
// retrying.
const CHALLENGE_IDEMPOTENCY_RETRY_AFTER = '1s';

/**
 * Minimal view of the native HTTP request the scope and fingerprint
 * functions need. The idempotency interceptor runs before pipes, so the body
 * is still the raw parsed JSON — normalization must happen here, reusing the
 * exact `toNationalMobile` implementation the validation pipe uses later.
 * Kept as an application-owned interface: no platform request type leaks in.
 */
interface IdempotencyScopeRequest {
  body?: unknown;
}

// The scope secret is resolved lazily on first use, through the same
// registerAs factory pattern main.ts uses for the server config. Decorator
// arguments evaluate at class-definition time — before a ConfigService
// instance exists — so the secret cannot be injected into the
// `challengeIdempotentOptions` object; a request-time lazy read keeps the
// application-free decorator options possible. Env validation has already
// run by the time any request arrives (env.config.ts validates at import).
let scopeSecretCache: string | undefined;
function resolveScopeSecret(): string {
  scopeSecretCache ??= idempotencyConfig().scopeSecret;
  return scopeSecretCache;
}

// WebCrypto algorithm parameters for the scope HMAC (ADR-039:
// HMAC-SHA256 over the normalized phone). The idempotency scope function may
// return a promise — the package awaits it — so the HMAC runs through
// crypto.subtle with the imported key cached module-locally: one key
// derivation per process, one bounded sign per request.
const SCOPE_HMAC_PARAMS = { name: 'HMAC', hash: 'SHA-256' } as const;
const SCOPE_TEXT_ENCODER = new TextEncoder();

let scopeKeyCache: Promise<CryptoKey> | undefined;
function resolveScopeKey(): Promise<CryptoKey> {
  scopeKeyCache ??= crypto.subtle.importKey(
    'raw',
    SCOPE_TEXT_ENCODER.encode(resolveScopeSecret()),
    SCOPE_HMAC_PARAMS,
    false,
    ['sign'],
  );
  return scopeKeyCache;
}

// The idempotency scope namespaces keys by logical caller: the normalized
// phone number, pseudonymized with a dedicated HMAC secret (ADR-039). No
// plain phone number ever reaches a Redis key, a log, or an event payload.
// Invalid input normalizes to a deterministic value too, so a request that
// will fail validation cannot collide with another caller's namespace.
async function challengeScope(request: IdempotencyScopeRequest): Promise<string> {
  const mac = await crypto.subtle.sign(
    SCOPE_HMAC_PARAMS,
    await resolveScopeKey(),
    SCOPE_TEXT_ENCODER.encode(normalizeRawPhone(request.body)),
  );
  return Buffer.from(mac).toString('hex');
}

// What a retry must repeat exactly: the normalized logical request. The
// package hashes this together with the scope, method, and URL, so
// equivalent phone spellings (+98 / 0098 / 98 / missing leading zero) share
// one fingerprint instead of a spurious key-reuse rejection.
function challengeFingerprint(body: unknown): string {
  return normalizeRawPhone(body);
}

// Final outcomes: store and replay success and deterministic client errors,
// but never the HTTP throttler's 429 (a temporary rejection must not become
// a permanent idempotency result — the key is released and a retry after the
// rate-limit window re-executes) and never a 5xx (the side-effect state is
// ambiguous). The package's own 409 IDEMPOTENCY_KEY_IN_USE is thrown before
// acquire and never reaches storeIf.
function challengeStoreIf(status: number): boolean {
  return status < HttpStatus.INTERNAL_SERVER_ERROR && status !== HttpStatus.TOO_MANY_REQUESTS;
}

function normalizeRawPhone(body: unknown): string {
  if (!isRecord(body) || typeof body.phoneNumber !== 'string') {
    return '';
  }
  return toNationalMobile(body.phoneNumber);
}

/**
 * `@Idempotent()` options for POST /enrollments/challenge (ADR-039). The
 * `Idempotency-Key` header is required (the package rejects a missing key
 * with 400 IDEMPOTENCY_KEY_REQUIRED before the handler runs); scope,
 * fingerprint, and storeIf are the phone-based decisions above.
 */
export const challengeIdempotentOptions: IdempotentOptions = {
  required: true,
  ttl: CHALLENGE_IDEMPOTENCY_RECORD_TTL,
  lockTtl: CHALLENGE_IDEMPOTENCY_LOCK_TTL,
  retryAfter: CHALLENGE_IDEMPOTENCY_RETRY_AFTER,
  scope: challengeScope,
  fingerprint: challengeFingerprint,
  storeIf: challengeStoreIf,
};
