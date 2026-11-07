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

// Real-Redis integration tests for the OTP verification lockout (pnpm test:redis).
// Uses Testcontainers for isolated, reproducible Redis instances.
// Mocks cannot prove atomicity, expiration, or race-condition behavior.

const CHALLENGE_OTP_TTL_SECONDS = 120;
const LOCKOUT_TTL_SECONDS = 900;
const MAX_VERIFY_ATTEMPTS = 5;

let testRedis: TestRedis;
let client: RedisClient;
let redisService: RedisService;

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

describe('RedisService.issueOtp + verifyOtpAndCountAttempts lockout behavior (real Redis via Testcontainers)', () => {
  const phoneNumber = '09123456789';

  it('issues an OTP when no lockout exists', async () => {
    const result = await redisService.issueOtp(
      challengeOtpKey(phoneNumber),
      challengeLockoutKey(phoneNumber),
      '123456',
      CHALLENGE_OTP_TTL_SECONDS,
    );
    expect(result).toBe('issued');

    // OTP key exists
    const otp = await client.get(challengeOtpKey(phoneNumber));
    expect(otp).toBe('123456');

    // Lockout key does not exist (ioredis exists returns 1/0)
    const lockoutExists = await client.exists(challengeLockoutKey(phoneNumber));
    expect(lockoutExists).toBe(0);
  });

  it('rejects issuance when an active OTP already exists', async () => {
    await redisService.issueOtp(
      challengeOtpKey(phoneNumber),
      challengeLockoutKey(phoneNumber),
      '123456',
      CHALLENGE_OTP_TTL_SECONDS,
    );

    const result = await redisService.issueOtp(
      challengeOtpKey(phoneNumber),
      challengeLockoutKey(phoneNumber),
      '654321',
      CHALLENGE_OTP_TTL_SECONDS,
    );
    expect(result).toBe('exists');
  });

  it('rejects issuance when a lockout is active', async () => {
    // Manually set a lockout key
    await client.set(challengeLockoutKey(phoneNumber), '1', 'EX', LOCKOUT_TTL_SECONDS);

    const result = await redisService.issueOtp(
      challengeOtpKey(phoneNumber),
      challengeLockoutKey(phoneNumber),
      '123456',
      CHALLENGE_OTP_TTL_SECONDS,
    );
    expect(result).toBe('locked');

    // No OTP should have been created
    const otp = await client.get(challengeOtpKey(phoneNumber));
    expect(otp).toBeNull();
  });

  it('verifies a correct OTP and clears all keys including lockout', async () => {
    await redisService.issueOtp(
      challengeOtpKey(phoneNumber),
      challengeLockoutKey(phoneNumber),
      '123456',
      CHALLENGE_OTP_TTL_SECONDS,
    );

    const verified = await redisService.verifyOtpAndCountAttempts(
      challengeOtpKey(phoneNumber),
      challengeAttemptsKey(phoneNumber),
      challengeLockoutKey(phoneNumber),
      '123456',
      MAX_VERIFY_ATTEMPTS,
      LOCKOUT_TTL_SECONDS,
    );

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
    await redisService.issueOtp(
      challengeOtpKey(phoneNumber),
      challengeLockoutKey(phoneNumber),
      '123456',
      CHALLENGE_OTP_TTL_SECONDS,
    );

    // 5 wrong attempts
    for (let i = 0; i < MAX_VERIFY_ATTEMPTS; i++) {
      const verified = await redisService.verifyOtpAndCountAttempts(
        challengeOtpKey(phoneNumber),
        challengeAttemptsKey(phoneNumber),
        challengeLockoutKey(phoneNumber),
        '000000',
        MAX_VERIFY_ATTEMPTS,
        LOCKOUT_TTL_SECONDS,
      );
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

  it('rejects verification when lockout is active (without incrementing attempts)', async () => {
    // Set lockout manually
    await client.set(challengeLockoutKey(phoneNumber), '1', 'EX', LOCKOUT_TTL_SECONDS);

    const verified = await redisService.verifyOtpAndCountAttempts(
      challengeOtpKey(phoneNumber),
      challengeAttemptsKey(phoneNumber),
      challengeLockoutKey(phoneNumber),
      '123456', // even correct OTP
      MAX_VERIFY_ATTEMPTS,
      LOCKOUT_TTL_SECONDS,
    );

    expect(verified).toBe(false);

    // No attempts key should be created (ioredis get returns null for missing)
    const attempts = await client.get(challengeAttemptsKey(phoneNumber));
    expect(attempts).toBeNull();
  });

  it('rejects new OTP issuance while lockout is active after max attempts', async () => {
    await redisService.issueOtp(
      challengeOtpKey(phoneNumber),
      challengeLockoutKey(phoneNumber),
      '123456',
      CHALLENGE_OTP_TTL_SECONDS,
    );

    // Exhaust attempts
    for (let i = 0; i < MAX_VERIFY_ATTEMPTS; i++) {
      await redisService.verifyOtpAndCountAttempts(
        challengeOtpKey(phoneNumber),
        challengeAttemptsKey(phoneNumber),
        challengeLockoutKey(phoneNumber),
        '000000',
        MAX_VERIFY_ATTEMPTS,
        LOCKOUT_TTL_SECONDS,
      );
    }

    // Now lockout is active - new OTP request should be rejected
    const issueResult = await redisService.issueOtp(
      challengeOtpKey(phoneNumber),
      challengeLockoutKey(phoneNumber),
      '654321',
      CHALLENGE_OTP_TTL_SECONDS,
    );
    expect(issueResult).toBe('locked');
  });

  it('lockout expires and allows new OTP after TTL', async () => {
    await redisService.issueOtp(
      challengeOtpKey(phoneNumber),
      challengeLockoutKey(phoneNumber),
      '123456',
      CHALLENGE_OTP_TTL_SECONDS,
    );

    // Exhaust attempts -> lockout set
    for (let i = 0; i < MAX_VERIFY_ATTEMPTS; i++) {
      await redisService.verifyOtpAndCountAttempts(
        challengeOtpKey(phoneNumber),
        challengeAttemptsKey(phoneNumber),
        challengeLockoutKey(phoneNumber),
        '000000',
        MAX_VERIFY_ATTEMPTS,
        LOCKOUT_TTL_SECONDS,
      );
    }

    // Verify lockout is active
    let lockout = await client.get(challengeLockoutKey(phoneNumber));
    expect(lockout).toBe('1');

    // Manually expire the lockout key (simulate TTL expiry)
    await client.del(challengeLockoutKey(phoneNumber));

    // Now new OTP should be allowed
    const issueResult = await redisService.issueOtp(
      challengeOtpKey(phoneNumber),
      challengeLockoutKey(phoneNumber),
      '654321',
      CHALLENGE_OTP_TTL_SECONDS,
    );
    expect(issueResult).toBe('issued');

    const otp = await client.get(challengeOtpKey(phoneNumber));
    expect(otp).toBe('654321');
  });

  it('attempts key TTL is set to lockout TTL (not OTP TTL)', async () => {
    await redisService.issueOtp(
      challengeOtpKey(phoneNumber),
      challengeLockoutKey(phoneNumber),
      '123456',
      CHALLENGE_OTP_TTL_SECONDS,
    );

    // One wrong attempt
    await redisService.verifyOtpAndCountAttempts(
      challengeOtpKey(phoneNumber),
      challengeAttemptsKey(phoneNumber),
      challengeLockoutKey(phoneNumber),
      '000000',
      MAX_VERIFY_ATTEMPTS,
      LOCKOUT_TTL_SECONDS,
    );

    // Attempts key should have TTL ~ lockout TTL (900s), not OTP TTL (120s)
    const attemptsTtl = await client.ttl(challengeAttemptsKey(phoneNumber));
    expect(attemptsTtl).toBeGreaterThan(800);
    expect(attemptsTtl).toBeLessThanOrEqual(LOCKOUT_TTL_SECONDS);
  });

  it('lockout key TTL is set to lockout TTL', async () => {
    await redisService.issueOtp(
      challengeOtpKey(phoneNumber),
      challengeLockoutKey(phoneNumber),
      '123456',
      CHALLENGE_OTP_TTL_SECONDS,
    );

    // Exhaust attempts
    for (let i = 0; i < MAX_VERIFY_ATTEMPTS; i++) {
      await redisService.verifyOtpAndCountAttempts(
        challengeOtpKey(phoneNumber),
        challengeAttemptsKey(phoneNumber),
        challengeLockoutKey(phoneNumber),
        '000000',
        MAX_VERIFY_ATTEMPTS,
        LOCKOUT_TTL_SECONDS,
      );
    }

    const lockoutTtl = await client.ttl(challengeLockoutKey(phoneNumber));
    expect(lockoutTtl).toBeGreaterThan(800);
    expect(lockoutTtl).toBeLessThanOrEqual(LOCKOUT_TTL_SECONDS);
  });

  it('different phone numbers have independent lockouts', async () => {
    const phoneA = '09123456789';
    const phoneB = '09123456788';

    // Lockout phone A
    await redisService.issueOtp(
      challengeOtpKey(phoneA),
      challengeLockoutKey(phoneA),
      '123456',
      CHALLENGE_OTP_TTL_SECONDS,
    );
    for (let i = 0; i < MAX_VERIFY_ATTEMPTS; i++) {
      await redisService.verifyOtpAndCountAttempts(
        challengeOtpKey(phoneA),
        challengeAttemptsKey(phoneA),
        challengeLockoutKey(phoneA),
        '000000',
        MAX_VERIFY_ATTEMPTS,
        LOCKOUT_TTL_SECONDS,
      );
    }

    // Phone A should be locked
    expect(
      await redisService.issueOtp(
        challengeOtpKey(phoneA),
        challengeLockoutKey(phoneA),
        '111111',
        CHALLENGE_OTP_TTL_SECONDS,
      ),
    ).toBe('locked');

    // Phone B should NOT be locked
    expect(
      await redisService.issueOtp(
        challengeOtpKey(phoneB),
        challengeLockoutKey(phoneB),
        '222222',
        CHALLENGE_OTP_TTL_SECONDS,
      ),
    ).toBe('issued');
  });

  it('concurrent issue and verify operations respect lockout atomically', async () => {
    // First issue an OTP
    await redisService.issueOtp(
      challengeOtpKey(phoneNumber),
      challengeLockoutKey(phoneNumber),
      '123456',
      CHALLENGE_OTP_TTL_SECONDS,
    );

    // Exhaust attempts via concurrent verifications (simulating race)
    const promises = Array.from({ length: 6 }, () =>
      redisService.verifyOtpAndCountAttempts(
        challengeOtpKey(phoneNumber),
        challengeAttemptsKey(phoneNumber),
        challengeLockoutKey(phoneNumber),
        '000000',
        MAX_VERIFY_ATTEMPTS,
        LOCKOUT_TTL_SECONDS,
      ),
    );
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
    const result = await redisService.issueOtp(
      challengeOtpKey(phoneNumber),
      challengeLockoutKey(phoneNumber),
      '123456',
      CHALLENGE_OTP_TTL_SECONDS,
    );
    expect(result).toBe('issued');
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
        '123456',
        CHALLENGE_OTP_TTL_SECONDS,
      ),
    ).rejects.toThrow();

    await expect(
      errorService.verifyOtpAndCountAttempts(
        challengeOtpKey(phoneNumber),
        challengeAttemptsKey(phoneNumber),
        challengeLockoutKey(phoneNumber),
        '123456',
        MAX_VERIFY_ATTEMPTS,
        LOCKOUT_TTL_SECONDS,
      ),
    ).rejects.toThrow();

    closedClient.disconnect();
  });
});
