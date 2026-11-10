import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { TestRedis } from './testcontainers.js';
import type { RedisClient } from '#src/shared/redis/inject-redis.decorator.js';
import { createRedisClient } from '#src/shared/redis/redis.provider.js';
import { REDIS_CLIENT } from '#src/shared/redis/redis.constants.js';
import { RedisService } from '#src/shared/redis/redis.service.js';
import {
  challengeAttemptsKey,
  challengeLockoutKey,
  challengeOtpKey,
  challengeRateLimitKey,
} from '#src/modules/enrollments/enrollments.keys.js';
import {
  composeOtpChallengeValue,
  computeOtpDigest,
  otpDigestMatches,
  parseOtpChallengeValue,
} from '#src/modules/enrollments/enrollments.otp-digest.js';

// Real-Redis integration tests for OTP digest storage and the verification
// lockout (pnpm test:redis). Uses Testcontainers for isolated, reproducible
// Redis instances. Mocks cannot prove atomicity, expiration, or race-condition
// behavior.

const CHALLENGE_OTP_TTL_SECONDS = 120;
const LOCKOUT_TTL_SECONDS = 900;
const MAX_VERIFY_ATTEMPTS = 5;
const SECRET = 'ab'.repeat(32);

let testRedis: TestRedis;
let client: RedisClient;
let redisService: RedisService;

// Issues a challenge the same way the service does: HMAC digest bound to a
// fresh per-issuance challenge ID, stored via the atomic issue script.
async function issueOtp(phone: string, otp: string): Promise<string> {
  const challengeId = randomUUID();
  const result = await redisService.issueOtp(
    challengeOtpKey(phone),
    challengeLockoutKey(phone),
    composeOtpChallengeValue(challengeId, computeOtpDigest(phone, otp, SECRET)),
    CHALLENGE_OTP_TTL_SECONDS,
  );
  if (result !== 'issued') {
    throw new Error(`Expected the challenge to be issued, got: ${result}`);
  }
  return challengeId;
}

// Mirrors the service's verification flow: read the stored value, parse it,
// compare the digest in Node with crypto.timingSafeEqual, then resolve the
// Redis state atomically with the observed challenge ID.
async function verifyOtp(phone: string, otp: string): Promise<boolean> {
  const otpKey = challengeOtpKey(phone);
  const parsed = parseOtpChallengeValue(await redisService.get(otpKey));
  const matched =
    parsed !== null && otpDigestMatches(computeOtpDigest(phone, otp, SECRET), parsed.digest);
  return redisService.resolveOtpVerification(
    otpKey,
    challengeAttemptsKey(phone),
    challengeLockoutKey(phone),
    parsed?.challengeId ?? '',
    matched,
    MAX_VERIFY_ATTEMPTS,
    LOCKOUT_TTL_SECONDS,
  );
}

async function cleanupKeys(): Promise<void> {
  const keys = await scanAllKeys();
  if (keys.length > 0) {
    await client.unlink(...keys);
  }
}

async function scanAllKeys(): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await client.scan(
      cursor,
      'MATCH',
      'neo-bank:enrollments:challenge:*',
      'COUNT',
      100,
    );
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0');
  return keys;
}

beforeAll(async () => {
  testRedis = new TestRedis();
  const config = await testRedis.start();
  client = createRedisClient(config);
  await client.connect();
  const module = await import('@nestjs/testing').then((m) => m.Test);
  const testingModule = await module
    .createTestingModule({
      providers: [
        RedisService,
        { provide: REDIS_CLIENT, useValue: client },
        {
          provide: require('@nestjs/config').ConfigService,
          useValue: { getOrThrow: vi.fn(() => ({ shutdownTimeoutMs: 2000 })) },
        },
      ],
    })
    .compile();
  redisService = testingModule.get(RedisService);
  await cleanupKeys();
});

afterEach(cleanupKeys);

afterAll(async () => {
  if (client) {
    await client.quit();
  }
  await testRedis.stop();
});

describe('RedisService.issueOtp + resolveOtpVerification lockout behavior (real Redis via Testcontainers)', () => {
  const phoneNumber = '09123456789';

  it('stores only the challenge value (challenge ID + OTP HMAC digest) — never the plaintext OTP — with the 120-second TTL', async () => {
    const challengeId = await issueOtp(phoneNumber, '123456');

    const stored = await client.get(challengeOtpKey(phoneNumber));
    expect(stored).not.toBeNull();
    expect(stored).not.toContain('123456');
    const parsed = parseOtpChallengeValue(stored);
    expect(parsed).toEqual({
      challengeId,
      digest: computeOtpDigest(phoneNumber, '123456', SECRET),
    });

    const ttl = await client.ttl(challengeOtpKey(phoneNumber));
    expect(ttl).toBeLessThanOrEqual(CHALLENGE_OTP_TTL_SECONDS);
    expect(ttl).toBeGreaterThan(CHALLENGE_OTP_TTL_SECONDS - 5);
  });

  it('rejects issuance when an active OTP already exists', async () => {
    await issueOtp(phoneNumber, '123456');

    const result = await redisService.issueOtp(
      challengeOtpKey(phoneNumber),
      challengeLockoutKey(phoneNumber),
      composeOtpChallengeValue(randomUUID(), computeOtpDigest(phoneNumber, '654321', SECRET)),
      CHALLENGE_OTP_TTL_SECONDS,
    );
    expect(result).toBe('exists');

    // The existing challenge value is untouched.
    const stored = await client.get(challengeOtpKey(phoneNumber));
    const parsed = parseOtpChallengeValue(stored);
    expect(parsed?.digest).toBe(computeOtpDigest(phoneNumber, '123456', SECRET));
  });

  it('rejects issuance when a lockout is active', async () => {
    // Manually set a lockout key
    await client.set(challengeLockoutKey(phoneNumber), '1', 'EX', LOCKOUT_TTL_SECONDS);

    const result = await redisService.issueOtp(
      challengeOtpKey(phoneNumber),
      challengeLockoutKey(phoneNumber),
      composeOtpChallengeValue(randomUUID(), computeOtpDigest(phoneNumber, '123456', SECRET)),
      CHALLENGE_OTP_TTL_SECONDS,
    );
    expect(result).toBe('locked');

    // No OTP should have been created
    const otp = await client.get(challengeOtpKey(phoneNumber));
    expect(otp).toBeNull();
  });

  it('verifies a correct OTP and clears all keys including lockout', async () => {
    await issueOtp(phoneNumber, '123456');

    const verified = await verifyOtp(phoneNumber, '123456');

    expect(verified).toBe(true);

    // All keys should be cleared
    const otp = await client.get(challengeOtpKey(phoneNumber));
    expect(otp).toBeNull();

    const attempts = await client.get(challengeAttemptsKey(phoneNumber));
    expect(attempts).toBeNull();

    const lockout = await client.get(challengeLockoutKey(phoneNumber));
    expect(lockout).toBeNull();
  });

  it('increments attempts on wrong OTP and sets lockout when max reached', async () => {
    await issueOtp(phoneNumber, '123456');

    // 5 wrong attempts
    for (let i = 0; i < MAX_VERIFY_ATTEMPTS; i++) {
      const verified = await verifyOtp(phoneNumber, '000000');
      expect(verified).toBe(false);
    }

    // Attempts key should be 5
    const attempts = await client.get(challengeAttemptsKey(phoneNumber));
    expect(attempts).toBe('5');

    // Lockout key should be set
    const lockout = await client.get(challengeLockoutKey(phoneNumber));
    expect(lockout).toBe('1');

    // OTP key should be invalidated (deleted)
    const otp = await client.get(challengeOtpKey(phoneNumber));
    expect(otp).toBeNull();
  });

  it('counts an attempt — without throwing — when the stored value is malformed', async () => {
    await client.set(
      challengeOtpKey(phoneNumber),
      'not-a-challenge-value',
      'EX',
      CHALLENGE_OTP_TTL_SECONDS,
    );

    const verified = await verifyOtp(phoneNumber, '123456');

    // Malformed stored value: failed match, counted as one attempt.
    expect(verified).toBe(false);
    const attempts = await client.get(challengeAttemptsKey(phoneNumber));
    expect(attempts).toBe('1');
  });

  it('never creates attempts or lockout when verifying without any challenge (ADR-019, F1)', async () => {
    // Garbage verifications against a phone with no OTP at all.
    for (let i = 0; i < MAX_VERIFY_ATTEMPTS + 1; i++) {
      const verified = await verifyOtp(phoneNumber, '000000');
      expect(verified).toBe(false);
    }

    // No attempts counter, no lockout — issuance must still be possible.
    const attempts = await client.get(challengeAttemptsKey(phoneNumber));
    expect(attempts).toBeNull();
    const lockout = await client.get(challengeLockoutKey(phoneNumber));
    expect(lockout).toBeNull();
    const issueResult = await redisService.issueOtp(
      challengeOtpKey(phoneNumber),
      challengeLockoutKey(phoneNumber),
      composeOtpChallengeValue(randomUUID(), computeOtpDigest(phoneNumber, '123456', SECRET)),
      CHALLENGE_OTP_TTL_SECONDS,
    );
    expect(issueResult).toBe('issued');
  });

  it('does not count attempts after the OTP has expired (ADR-019, F1)', async () => {
    await issueOtp(phoneNumber, '123456');

    // Simulate TTL expiry by removing the OTP key.
    await client.unlink(challengeOtpKey(phoneNumber));

    const verified = await verifyOtp(phoneNumber, '000000');

    expect(verified).toBe(false);
    const attempts = await client.get(challengeAttemptsKey(phoneNumber));
    expect(attempts).toBeNull();
    const lockout = await client.get(challengeLockoutKey(phoneNumber));
    expect(lockout).toBeNull();
  });

  it('rejects verification when lockout is active (without incrementing attempts)', async () => {
    await issueOtp(phoneNumber, '123456');

    // Set lockout manually
    await client.set(challengeLockoutKey(phoneNumber), '1', 'EX', LOCKOUT_TTL_SECONDS);

    const verified = await verifyOtp(phoneNumber, '123456'); // even the correct OTP

    expect(verified).toBe(false);

    // No attempts key should be created (ioredis get returns null for missing)
    const attempts = await client.get(challengeAttemptsKey(phoneNumber));
    expect(attempts).toBeNull();
  });

  it('never consumes a replaced challenge through a stale match (ADR-019, F2)', async () => {
    const expiredChallengeId = await issueOtp(phoneNumber, '111111');

    // Simulate TTL expiry + re-issuance: the old key is gone, a new challenge
    // with a different ID and digest takes its place.
    await client.unlink(challengeOtpKey(phoneNumber));
    const replacedChallengeId = await issueOtp(phoneNumber, '222222');

    // The Node side verified the FIRST challenge's digest, then the resolve
    // runs against the replaced key.
    const verified = await redisService.resolveOtpVerification(
      challengeOtpKey(phoneNumber),
      challengeAttemptsKey(phoneNumber),
      challengeLockoutKey(phoneNumber),
      expiredChallengeId,
      true,
      MAX_VERIFY_ATTEMPTS,
      LOCKOUT_TTL_SECONDS,
    );

    // The replaced challenge is not consumed; the attempt is counted.
    expect(verified).toBe(false);
    const attempts = await client.get(challengeAttemptsKey(phoneNumber));
    expect(attempts).toBe('1');
    const stored = parseOtpChallengeValue(await client.get(challengeOtpKey(phoneNumber)));
    expect(stored?.challengeId).toBe(replacedChallengeId);

    // The replacement itself still verifies normally.
    const verifiedReplacement = await verifyOtp(phoneNumber, '222222');
    expect(verifiedReplacement).toBe(true);
  });

  it('rejects a matched OTP whose key disappeared between the Node-side read and the resolve', async () => {
    const challengeId = await issueOtp(phoneNumber, '123456');

    // Read + compute a match, then delete the key before resolving — exactly
    // the race window the two-phase design has.
    await client.unlink(challengeOtpKey(phoneNumber));

    const verified = await redisService.resolveOtpVerification(
      challengeOtpKey(phoneNumber),
      challengeAttemptsKey(phoneNumber),
      challengeLockoutKey(phoneNumber),
      challengeId,
      true,
      MAX_VERIFY_ATTEMPTS,
      LOCKOUT_TTL_SECONDS,
    );

    // The resolve re-checks key existence: no consumption of a missing key,
    // and — per ADR-019's conditional counting — no attempt either.
    expect(verified).toBe(false);
    const attempts = await client.get(challengeAttemptsKey(phoneNumber));
    expect(attempts).toBeNull();
  });

  it('rejects new OTP issuance while lockout is active after max attempts', async () => {
    await issueOtp(phoneNumber, '123456');

    // Exhaust attempts
    for (let i = 0; i < MAX_VERIFY_ATTEMPTS; i++) {
      await verifyOtp(phoneNumber, '000000');
    }

    // Now lockout is active - new OTP request should be rejected
    const issueResult = await redisService.issueOtp(
      challengeOtpKey(phoneNumber),
      challengeLockoutKey(phoneNumber),
      composeOtpChallengeValue(randomUUID(), computeOtpDigest(phoneNumber, '654321', SECRET)),
      CHALLENGE_OTP_TTL_SECONDS,
    );
    expect(issueResult).toBe('locked');
  });

  it('lockout expires and allows new OTP after TTL', async () => {
    await issueOtp(phoneNumber, '123456');

    // Exhaust attempts -> lockout set
    for (let i = 0; i < MAX_VERIFY_ATTEMPTS; i++) {
      await verifyOtp(phoneNumber, '000000');
    }

    // Verify lockout is active
    const lockout = await client.get(challengeLockoutKey(phoneNumber));
    expect(lockout).toBe('1');

    // Manually expire the lockout key (simulate TTL expiry)
    await client.del(challengeLockoutKey(phoneNumber));

    // Now new OTP should be allowed
    const challengeId = await issueOtp(phoneNumber, '654321');

    const stored = parseOtpChallengeValue(await client.get(challengeOtpKey(phoneNumber)));
    expect(stored?.challengeId).toBe(challengeId);
    expect(stored?.digest).toBe(computeOtpDigest(phoneNumber, '654321', SECRET));
  });

  it('attempts key TTL is set to lockout TTL (not OTP TTL)', async () => {
    await issueOtp(phoneNumber, '123456');

    // One wrong attempt
    await verifyOtp(phoneNumber, '000000');

    // Attempts key should have TTL ~ lockout TTL (900s), not OTP TTL (120s)
    const attemptsTtl = await client.ttl(challengeAttemptsKey(phoneNumber));
    expect(attemptsTtl).toBeGreaterThan(800);
    expect(attemptsTtl).toBeLessThanOrEqual(LOCKOUT_TTL_SECONDS);
  });

  it('lockout key TTL is set to lockout TTL', async () => {
    await issueOtp(phoneNumber, '123456');

    // Exhaust attempts
    for (let i = 0; i < MAX_VERIFY_ATTEMPTS; i++) {
      await verifyOtp(phoneNumber, '000000');
    }

    const lockoutTtl = await client.ttl(challengeLockoutKey(phoneNumber));
    expect(lockoutTtl).toBeGreaterThan(800);
    expect(lockoutTtl).toBeLessThanOrEqual(LOCKOUT_TTL_SECONDS);
  });

  it('different phone numbers have independent lockouts', async () => {
    const phoneA = '09123456789';
    const phoneB = '09123456788';

    // Lockout phone A
    await issueOtp(phoneA, '123456');
    for (let i = 0; i < MAX_VERIFY_ATTEMPTS; i++) {
      await verifyOtp(phoneA, '000000');
    }

    // Phone A should be locked
    expect(
      await redisService.issueOtp(
        challengeOtpKey(phoneA),
        challengeLockoutKey(phoneA),
        composeOtpChallengeValue(randomUUID(), computeOtpDigest(phoneA, '111111', SECRET)),
        CHALLENGE_OTP_TTL_SECONDS,
      ),
    ).toBe('locked');

    // Phone B should NOT be locked
    expect(
      await redisService.issueOtp(
        challengeOtpKey(phoneB),
        challengeLockoutKey(phoneB),
        composeOtpChallengeValue(randomUUID(), computeOtpDigest(phoneB, '222222', SECRET)),
        CHALLENGE_OTP_TTL_SECONDS,
      ),
    ).toBe('issued');
  });

  it('concurrent issue and verify operations respect lockout atomically', async () => {
    // First issue an OTP
    await issueOtp(phoneNumber, '123456');

    // Exhaust attempts via concurrent verifications (simulating race)
    const promises = Array.from({ length: 6 }, () => verifyOtp(phoneNumber, '000000'));
    const results = await Promise.all(promises);

    // All should fail
    expect(results.every((r) => r === false)).toBe(true);

    // Only MAX_VERIFY_ATTEMPTS should increment (the 6th is already locked)
    const attempts = await client.get(challengeAttemptsKey(phoneNumber));
    expect(parseInt(attempts || '0', 10)).toBe(MAX_VERIFY_ATTEMPTS);

    // Lockout should be set
    const lockout = await client.get(challengeLockoutKey(phoneNumber));
    expect(lockout).toBe('1');
  });

  it('hourly rate limit is independent of lockout', async () => {
    // The hourly rate limit key is separate from lockout/attempts/otp keys
    const rateLimitKey = challengeRateLimitKey(phoneNumber);

    // Exhaust the hourly rate limit (5 sends)
    for (let i = 0; i < 5; i++) {
      const allowed = await redisService.checkOtpRateLimit(rateLimitKey, 5, 60);
      expect(allowed).toBe(true);
    }

    // 6th send should be rate limited
    const allowed = await redisService.checkOtpRateLimit(rateLimitKey, 5, 60);
    expect(allowed).toBe(false);

    // But lockout is a separate mechanism - issueOtp checks lockout, not hourly limit
    // (hourly limit is checked BEFORE calling issueOtp in the service layer)
    const challengeId = await issueOtp(phoneNumber, '123456');
    const stored = parseOtpChallengeValue(await client.get(challengeOtpKey(phoneNumber)));
    expect(stored?.challengeId).toBe(challengeId);
  });

  it('handles Redis errors gracefully (propagates to caller)', async () => {
    // Create a service with a client pointing to an unroutable address
    const closedClient = createRedisClient({
      url: 'redis://127.0.0.1:1', // Unroutable
      username: '',
      password: '',
      db: 0,
      tls: false,
      connectTimeoutMs: 100,
      commandTimeoutMs: 100,
      maxRetriesPerRequest: 1,
      shutdownTimeoutMs: 100,
    });
    closedClient.connect().catch(() => {});

    const module = await import('@nestjs/testing').then((m) => m.Test);
    const testingModule = await module
      .createTestingModule({
        providers: [
          RedisService,
          { provide: REDIS_CLIENT, useValue: closedClient },
          {
            provide: require('@nestjs/config').ConfigService,
            useValue: { getOrThrow: vi.fn(() => ({ shutdownTimeoutMs: 2000 })) },
          },
        ],
      })
      .compile();
    const errorService = testingModule.get(RedisService);

    // Act & Assert: should throw when the Lua script is evaluated
    await expect(
      errorService.issueOtp(
        challengeOtpKey(phoneNumber),
        challengeLockoutKey(phoneNumber),
        composeOtpChallengeValue(randomUUID(), computeOtpDigest(phoneNumber, '123456', SECRET)),
        CHALLENGE_OTP_TTL_SECONDS,
      ),
    ).rejects.toThrow();

    await expect(
      errorService.resolveOtpVerification(
        challengeOtpKey(phoneNumber),
        challengeAttemptsKey(phoneNumber),
        challengeLockoutKey(phoneNumber),
        randomUUID(),
        false,
        MAX_VERIFY_ATTEMPTS,
        LOCKOUT_TTL_SECONDS,
      ),
    ).rejects.toThrow();

    closedClient.disconnect();
  });
});
