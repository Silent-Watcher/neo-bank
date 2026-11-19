import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import request from 'supertest';
import { createHmac, createHash, randomUUID } from 'node:crypto';

import { IdempotencyStorage } from '@nestjs/idempotency';
import type { NestNodeApplication } from '@nestjs/platform-node';

import { RedisIdempotencyStore } from '#src/shared/idempotency/redis-idempotency.store.js';
import { RedisService } from '#redis/redis.service.js';
import { createRedisClient } from '#redis/redis.provider.js';
import type { RedisClient } from '#redis/inject-redis.decorator.js';
import { _env } from '#config/env/env.config.js';
import { createE2eTestApp } from './create-test-app.js';

// E2E coverage for the idempotent enrollment challenge (ADR-039). Every
// scenario runs against the real pipeline — global guards, the global
// IdempotencyInterceptor with the Redis-backed store, the response envelope,
// the deferred route-level rate limiter — with the real Redis for OTP, quota,
// and idempotency records (the shared Testcontainers container, ADR-025).
//
// Quota-not-consumed claims are proven by reading the throttler's own Redis
// keys before and after each replay, never by trusting that the handler was
// skipped. The keys are derived exactly as the official guard generates them
// (sha256 of `controller-handler-policy-tracker`), so the assertions read one
// tracker's counters and stay immune to parallel e2e files sharing the
// container. Idempotency record keys are derived the same way from the
// package's record-key construction (scope:key, URI-encoded, sha256'd).
//
// Key-reuse rejection (422 IDEMPOTENCY_KEY_REUSED) is deliberately unreachable
// on this endpoint: the scope is the HMAC of the normalized phone and the
// fingerprint is that same normalized phone, so within one scope no
// semantically different request exists, and a different phone lands in a
// different scope (scenario I). Scenario G of the review checklist — the 422
// key-reuse case — is therefore the deliberately dropped letter here; the
// package's fingerprint check remains as defense in depth and is covered by
// the package's own suite, while the Swagger contract still documents the 422.

const CHALLENGE_URL = '/api/v1/enrollments/challenge';
const PHONE = '09123456789';

function scopeForPhone(phone: string): string {
  return createHmac('sha256', _env.IDEMPOTENCY_SCOPE_SECRET).update(phone, 'utf8').digest('hex');
}

function recordKeyFor(phone: string, key: string): string {
  // The package storeKey: [scope, client key], URI-encoded, ':'-joined.
  const packageStoreKey = [scopeForPhone(phone), key].map(encodeURIComponent).join(':');
  return `neo-bank:idempotency:store:record:${createHash('sha256').update(packageStoreKey, 'utf8').digest('hex')}`;
}

// The official ThrottlerGuard key generation, mirrored for assertions.
function throttleKeyFor(tracker: string, resource: 'hit' | 'block', policy: string): string {
  const hash = createHash('sha256')
    .update(`EnrollmentsController-requestChallenge-${policy}-${tracker}`, 'utf8')
    .digest('hex');
  return `neo-bank:throttler:rate-limit:${resource}:{${hash}}`;
}

async function hitCount(tracker: string, policy: 'short' | 'long'): Promise<number> {
  return Number((await inspectClient.get(throttleKeyFor(tracker, 'hit', policy))) ?? 0);
}

async function isBlocked(tracker: string): Promise<boolean> {
  return (await inspectClient.exists(throttleKeyFor(tracker, 'block', 'short'))) === 1;
}

async function recordExists(phone: string, key: string): Promise<boolean> {
  return (await inspectClient.exists(recordKeyFor(phone, key))) === 1;
}

async function scanKeys(pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await inspectClient.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0');
  return keys;
}

async function cleanupKeys(): Promise<void> {
  // The idempotency records, the throttle counters, and the enrollment
  // challenge state (OTP keys, per-phone quota, lockouts) all live in the
  // shared e2e container; each scenario starts from an empty slate.
  for (const pattern of [
    'neo-bank:idempotency:*',
    'neo-bank:throttler:*',
    'neo-bank:enrollments:*',
  ]) {
    const keys = await scanKeys(pattern);
    if (keys.length > 0) {
      await inspectClient.unlink(...keys);
    }
  }
}

let inspectClient: RedisClient;

beforeAll(async () => {
  inspectClient = createRedisClient({
    ...inject('e2eRedisConfig'),
    db: 0,
    tls: false,
    connectTimeoutMs: 2000,
    commandTimeoutMs: 2000,
    maxRetriesPerRequest: 1,
    shutdownTimeoutMs: 1000,
  });
  await inspectClient.connect();
  await cleanupKeys();
});

afterEach(cleanupKeys);

afterAll(async () => {
  await cleanupKeys();
  await inspectClient.quit();
});

interface TestApp {
  app: NestNodeApplication;
  close: () => Promise<void>;
}

function createApp(): Promise<TestApp> {
  return createE2eTestApp().then((app) => ({ app, close: () => app.close() }));
}

function postChallenge(
  app: NestNodeApplication,
  options: { key?: string; tracker: string; phone?: string },
) {
  const post = request(app.getHttpServer()).post(CHALLENGE_URL);
  if (options.key !== undefined) {
    post.set('Idempotency-Key', options.key);
  }
  return post.set('X-Forwarded-For', options.tracker).send({ phoneNumber: options.phone ?? PHONE });
}

describe('Idempotent enrollment challenge (e2e, ADR-039)', () => {
  it('boots with the Redis-backed store registered and no in-memory store', async () => {
    // Arrange
    const { app, close } = await createApp();

    // Act + Assert — the package's supported diagnostic: the active store is
    // the Redis implementation, so no in-memory store is in play anywhere.
    expect(app.get(IdempotencyStorage).source).toBeInstanceOf(RedisIdempotencyStore);
    await close();
  });

  it('A: first request executes once, consumes quota once, and stores the record', async () => {
    // Arrange
    const { app, close } = await createApp();
    const issueOtp = vi.spyOn(app.get(RedisService), 'issueOtp');
    const tracker = '198.51.100.1';
    const key = randomUUID();

    // Act
    const response = await postChallenge(app, { key, tracker });

    // Assert — 202 with a genuinely empty body; handler and rate limiter ran
    // exactly once; the completed record is in Redis.
    expect(response.status).toBe(202);
    expect(response.text).toBe('');
    expect(response.body).toEqual({});
    expect(JSON.stringify(response.body)).not.toContain(PHONE);
    expect(issueOtp).toHaveBeenCalledTimes(1);
    expect(await hitCount(tracker, 'short')).toBe(1);
    expect(await hitCount(tracker, 'long')).toBe(1);
    expect(await isBlocked(tracker)).toBe(false);
    expect(await recordExists(PHONE, key)).toBe(true);
    await close();
  });

  it('B: completed replay returns the stored empty 202 without the handler or the rate limiter', async () => {
    // Arrange
    const { app, close } = await createApp();
    const redisService = app.get(RedisService);
    const issueOtp = vi.spyOn(redisService, 'issueOtp');
    const tracker = '198.51.100.2';
    const key = randomUUID();

    // Act
    const first = await postChallenge(app, { key, tracker });
    const otpKeyBefore = await inspectClient.get('neo-bank:enrollments:challenge:otp:09123456789');
    const shortBefore = await hitCount(tracker, 'short');
    const longBefore = await hitCount(tracker, 'long');
    const replay = await postChallenge(app, { key, tracker });
    const otpKeyAfter = await inspectClient.get('neo-bank:enrollments:challenge:otp:09123456789');

    // Assert
    expect(first.status).toBe(202);
    expect(replay.status).toBe(202);
    expect(replay.text).toBe('');
    expect(replay.headers['idempotent-replayed']).toBe('true');
    // No additional OTP side effect and no additional quota.
    expect(issueOtp).toHaveBeenCalledTimes(1);
    expect(otpKeyAfter).toBe(otpKeyBefore);
    expect(await hitCount(tracker, 'short')).toBe(shortBefore);
    expect(await hitCount(tracker, 'long')).toBe(longBefore);
    await close();
  });

  it('C: an in-flight duplicate receives 409 IDEMPOTENCY_KEY_IN_USE without quota, and replays after completion', async () => {
    // Arrange — the handler is stalled inside the OTP issuance so a second
    // request with the same key arrives while the first is in flight. The
    // stall wraps the REAL issuance: releasing it lets the first request
    // complete through the genuine flow. The first request is started
    // eagerly (supertest only fires a request once a handler is attached).
    const { app, close } = await createApp();
    const redisService = app.get(RedisService);
    const originalIssueOtp = redisService.issueOtp.bind(redisService);
    let releaseHandler: (() => void) | undefined;
    const handlerEntered = new Promise<void>((resolveEntered) => {
      vi.spyOn(redisService, 'issueOtp').mockImplementation(
        (...args: Parameters<typeof redisService.issueOtp>) => {
          resolveEntered();
          return new Promise((resolve) => {
            releaseHandler = (): void => {
              void originalIssueOtp(...args).then(resolve);
            };
          });
        },
      );
    });
    const tracker = '198.51.100.3';
    const key = randomUUID();

    // Act — first request goes in flight.
    const firstPromise = postChallenge(app, { key, tracker }).then((response) => response);
    await handlerEntered;
    const shortInFlight = await hitCount(tracker, 'short');
    const longInFlight = await hitCount(tracker, 'long');

    const duplicate = await postChallenge(app, { key, tracker });

    // Release the handler; the first request completes and stores its result.
    releaseHandler?.();
    const first = await firstPromise;
    const replay = await postChallenge(app, { key, tracker });

    // Assert
    expect(duplicate.status).toBe(409);
    expect(duplicate.headers['content-type']).toContain('application/problem+json');
    expect(duplicate.headers['retry-after']).toBe('1');
    expect(duplicate.body.code).toBe('IDEMPOTENCY_KEY_IN_USE');
    expect(duplicate.body.title).toBe('Idempotency Key In Use');
    expect(duplicate.body.detail).toContain('still being processed');
    // The duplicate consumed no quota: the counters are exactly the ones the
    // in-flight first request already paid for.
    expect(await hitCount(tracker, 'short')).toBe(shortInFlight);
    expect(await hitCount(tracker, 'long')).toBe(longInFlight);
    // The first request completes as an empty 202 and later replays.
    expect(first.status).toBe(202);
    expect(first.text).toBe('');
    expect(replay.status).toBe(202);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    await close();
  });

  it('D: a completed replay succeeds even when the rate-limit quota is exhausted', async () => {
    // Arrange — one completed logical operation, then two more (distinct
    // phones, so the business active-OTP rule never interferes) that exhaust
    // the route's per-IP short quota (2 per 120 s) and block the tracker.
    const { app, close } = await createApp();
    const completedKey = randomUUID();
    const tracker = '198.51.100.4';

    // Act
    const first = await postChallenge(app, {
      key: completedKey,
      tracker,
      phone: '09111111101',
    });
    const second = await postChallenge(app, {
      key: randomUUID(),
      tracker,
      phone: '09111111102',
    });
    const exhausted = await postChallenge(app, {
      key: randomUUID(),
      tracker,
      phone: '09111111103',
    });
    const shortExhausted = await hitCount(tracker, 'short');
    // The replay carries the SAME logical request as the completed operation.
    const replay = await postChallenge(app, {
      key: completedKey,
      tracker,
      phone: '09111111101',
    });
    const newOperation = await postChallenge(app, {
      key: randomUUID(),
      tracker,
      phone: '09111111104',
    });

    // Assert
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(exhausted.status).toBe(429);
    // The replay bypasses the rate limiter entirely: quota is exhausted (the
    // tracker is blocked), yet the stored 202 comes back untouched.
    expect(await isBlocked(tracker)).toBe(true);
    expect(replay.status).toBe(202);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.text).toBe('');
    expect(await hitCount(tracker, 'short')).toBe(shortExhausted);
    // A new logical operation under the same exhausted quota stays rejected.
    expect(newOperation.status).toBe(429);
    await close();
  });

  it('E: a 429 is never stored as the idempotency result — the key re-executes after the window', async () => {
    // Arrange — exhaust the route quota with two operations (distinct
    // phones), then ask a third logical operation under its own key.
    const { app, close } = await createApp();
    const issueOtp = vi.spyOn(app.get(RedisService), 'issueOtp');
    const tracker = '198.51.100.5';

    // Act
    await postChallenge(app, { key: randomUUID(), tracker, phone: '09111111111' });
    await postChallenge(app, { key: randomUUID(), tracker, phone: '09111111112' });
    const rejectedKey = randomUUID();
    const rejected = await postChallenge(app, {
      key: rejectedKey,
      tracker,
      phone: '09111111113',
    });
    const rejectedRecordStored = await recordExists('09111111113', rejectedKey);
    // Simulated cooldown: the throttler's window state is exactly the hit and
    // block keys, so clearing them is the window expiring (the real window is
    // 120 s; the re-execution semantics below are what the scenario proves).
    const throttleKeys = await scanKeys('neo-bank:throttler:rate-limit:*');
    await inspectClient.unlink(...throttleKeys);
    // The SAME key retries: the 429 must not have been recorded as its result.
    const retry = await postChallenge(app, {
      key: rejectedKey,
      tracker,
      phone: '09111111113',
    });

    // Assert
    expect(rejected.status).toBe(429);
    expect(rejectedRecordStored).toBe(false);
    expect(retry.status).toBe(202);
    expect(retry.headers['idempotent-replayed']).toBeUndefined();
    // Three handler executions: the two completed operations and the retry.
    expect(issueOtp).toHaveBeenCalledTimes(3);
    await close();
  });

  it('F: different keys are different logical operations through the rate limiter', async () => {
    // Arrange — same phone, two keys. The second hits the business-level
    // active-OTP guard (a deterministic 400, which storeIf keeps), and both
    // operations consumed quota independently.
    const { app, close } = await createApp();
    const tracker = '198.51.100.6';

    // Act
    const firstKey = randomUUID();
    const secondKey = randomUUID();
    const first = await postChallenge(app, { key: firstKey, tracker });
    const second = await postChallenge(app, { key: secondKey, tracker });
    const third = await postChallenge(app, { key: randomUUID(), tracker });

    // Assert
    expect(first.status).toBe(202);
    expect(second.status).toBe(400); // active OTP already exists (business rule)
    expect(second.headers['idempotent-replayed']).toBeUndefined();
    expect(third.status).toBe(429); // per-IP short quota (2 per 120 s) exhausted
    expect(await recordExists(PHONE, firstKey)).toBe(true);
    expect(await recordExists(PHONE, secondKey)).toBe(true); // the stored 400
    await close();
  });

  it('H: equivalent phone spellings share one scope and fingerprint — the replay wins', async () => {
    // Arrange
    const { app, close } = await createApp();
    const issueOtp = vi.spyOn(app.get(RedisService), 'issueOtp');
    const key = randomUUID();
    const tracker = '198.51.100.7';

    // Act — accepted spellings of the same number (per the existing
    // normalizer) with the same key.
    const first = await postChallenge(app, {
      key,
      tracker,
      phone: '+989123456789',
    });
    const replay = await postChallenge(app, { key, tracker, phone: '00989123456789' });

    // Assert — one logical operation: one OTP issuance, one stored replay.
    expect(first.status).toBe(202);
    expect(replay.status).toBe(202);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(issueOtp).toHaveBeenCalledTimes(1);
    expect(await recordExists(PHONE, key)).toBe(true);
    await close();
  });

  it('I: different phone numbers are isolated scopes under the same client key', async () => {
    // Arrange
    const { app, close } = await createApp();
    const issueOtp = vi.spyOn(app.get(RedisService), 'issueOtp');
    const key = randomUUID();
    const tracker = '198.51.100.8';
    const otherPhone = '09222222222';

    // Act — the same key for two different phones: distinct scopes, so both
    // execute (scope is a namespace, not a deduplication of the key alone).
    const first = await postChallenge(app, { key, tracker });
    const second = await postChallenge(app, { key, tracker, phone: otherPhone });

    // Assert
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(second.headers['idempotent-replayed']).toBeUndefined();
    expect(issueOtp).toHaveBeenCalledTimes(2);
    expect(await recordExists(PHONE, key)).toBe(true);
    expect(await recordExists(otherPhone, key)).toBe(true);
    await close();
  });

  it('J: a missing or malformed key is rejected before any handler or quota', async () => {
    // Arrange
    const { app, close } = await createApp();
    const issueOtp = vi.spyOn(app.get(RedisService), 'issueOtp');
    const tracker = '198.51.100.9';

    // Act
    const missing = await postChallenge(app, { tracker });
    const malformed = await postChallenge(app, {
      key: 'k'.repeat(256),
      tracker,
    });

    // Assert — the package rejections map onto the bilingual Problem Details
    // contract with the package code strings intact.
    expect(missing.status).toBe(400);
    expect(missing.headers['content-type']).toContain('application/problem+json');
    expect(missing.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(missing.body.title).toBe('Idempotency Key Required');
    expect(malformed.status).toBe(400);
    expect(malformed.body.code).toBe('IDEMPOTENCY_KEY_INVALID');
    expect(malformed.body.title).toBe('Invalid Idempotency Key');
    // Neither request reached the rate limiter or the handler.
    expect(await hitCount(tracker, 'short')).toBe(0);
    expect(await hitCount(tracker, 'long')).toBe(0);
    expect(await isBlocked(tracker)).toBe(false);
    expect(issueOtp).not.toHaveBeenCalled();
    expect(await recordExists(PHONE, 'missing')).toBe(false);
    await close();
  });

  it('exposes the replay metadata through CORS and admits the Idempotency-Key preflight', async () => {
    // Arrange — CORS_ORIGIN is configured in the e2e environment.
    const { app, close } = await createApp();

    // Act
    const preflight = await request(app.getHttpServer())
      .options(CHALLENGE_URL)
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'idempotency-key, content-type');
    const served = await postChallenge(app, { key: randomUUID(), tracker: '198.51.100.10' });

    // Assert — allowedHeaders stays unset on purpose: the preflight echoes
    // the requested headers, which admits Idempotency-Key; the response
    // headers expose the replay marker and the Retry-After hint.
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-headers']?.toLowerCase()).toContain(
      'idempotency-key',
    );
    const exposed = preflight.headers['access-control-expose-headers']?.toLowerCase() ?? '';
    expect(exposed).toContain('idempotent-replayed');
    expect(exposed).toContain('retry-after');
    expect(served.headers['access-control-expose-headers']?.toLowerCase()).toContain(
      'idempotent-replayed',
    );
    await close();
  });

  it('K: an unavailable idempotency store fails the request closed with a generic 500', async () => {
    // Arrange — the store provider is replaced by one whose operations
    // reject; it registers itself with the package registry, so there is no
    // in-memory fallback to trip into.
    const { app, close } = await createE2eTestApp(undefined, {
      configureModule: (builder) =>
        builder.overrideProvider(RedisIdempotencyStore).useFactory({
          inject: [IdempotencyStorage],
          factory: (storage: IdempotencyStorage) => {
            const failure = () => Promise.reject(new Error('store unavailable'));
            const failingStore = {
              acquire: failure,
              complete: failure,
              release: failure,
              extend: failure,
            };
            storage.registerSource(failingStore);
            return failingStore;
          },
        }),
    }).then((app) => ({ app, close: () => app.close() }));
    const tracker = '198.51.100.11';
    const key = randomUUID();

    // Act
    const response = await postChallenge(app, { key, tracker });

    // Assert — the application's fail-safe policy: bounded generic failure,
    // no internal details, no quota consumed (the acquire happens before the
    // deferred rate limiter), and nothing stored.
    expect(response.status).toBe(500);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body.code).toBe('APPLICATION_ERROR');
    expect(response.body.detail).toBe('An unexpected error occurred.');
    expect(JSON.stringify(response.body)).not.toContain('store unavailable');
    expect(await hitCount(tracker, 'short')).toBe(0);
    expect(await recordExists(PHONE, key)).toBe(false);
    await close();
  });
});
