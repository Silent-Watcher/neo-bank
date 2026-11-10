import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { TestingModuleBuilder } from '@nestjs/testing';

import { randomUUID } from 'node:crypto';
import { RedisService } from '#src/shared/redis/redis.service.js';
import { RATE_LIMIT_CONFIG } from '#config/rate-limit.config.js';
import { createRedisClient } from '#src/shared/redis/redis.provider.js';
import { createTestApp } from './create-test-app.js';
import { _env } from '#src/shared/config/env/env.config.js';
import {
  composeOtpChallengeValue,
  computeOtpDigest,
} from '#src/modules/enrollments/enrollments.otp-digest.js';
import type { RedisClient } from '#src/shared/redis/inject-redis.decorator.js';

let inspectClient: RedisClient;

async function cleanupKeys(): Promise<void> {
  const keys = await scanThrottleKeys();
  if (keys.length > 0) {
    await inspectClient.unlink(...keys);
  }
}

async function scanThrottleKeys(): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await inspectClient.scan(
      cursor,
      'MATCH',
      'neo-bank:throttler:rate-limit:*',
      'COUNT',
      100,
    );
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0');
  return keys;
}

beforeAll(async () => {
  inspectClient = createRedisClient({
    url: _env.REDIS_URL,
    username: _env.REDIS_USERNAME,
    password: _env.REDIS_PASSWORD,
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

function createTestAppWithMockRedis(
  configureModule?: (builder: TestingModuleBuilder) => void,
): Promise<{ app: Awaited<ReturnType<typeof createTestApp>>; close: () => Promise<void> }> {
  return createTestApp(undefined, {
    configureModule: (builder) =>
      builder
        .overrideProvider(RedisService)
        .useValue(configureModule ? undefined : undefined)
        .overrideProvider(RATE_LIMIT_CONFIG)
        .useValue({
          shortLimit: 10000,
          shortTtlSeconds: 1,
          longLimit: 100000,
          longTtlMinutes: 1,
        }),
  }).then((app) => ({
    app,
    close: () => app.close(),
  }));
}

function overrideRedisService(
  app: Awaited<ReturnType<typeof createTestApp>>,
  methods: Record<string, unknown>,
) {
  const redisService = app.get(RedisService);
  Object.assign(redisService, methods);
}

describe('EnrollmentsController (e2e)', () => {
  // Redis is overridden so the suite verifies the exact key, TTL, and stored
  // value without requiring a running Redis server. The global rate limiter
  // uses the real Redis from env.test (high limits) so validation errors are
  // not masked by throttling.

  it('validates the phone number, stores only the challenge value (challenge ID + OTP HMAC digest) in Redis, and returns only the phone number', async () => {
    // Arrange
    const issueOtp = vi
      .fn<
        (
          otpKey: string,
          lockoutKey: string,
          challengeValue: string,
          ttlSeconds: number,
        ) => Promise<'issued' | 'exists' | 'locked'>
      >()
      .mockResolvedValue('issued');
    const checkOtpRateLimit = vi
      .fn<(rateLimitKey: string, maxSends: number, windowMinutes: number) => Promise<boolean>>()
      .mockResolvedValue(true);
    const { app, close } = await createTestAppWithMockRedis();
    overrideRedisService(app, { issueOtp, checkOtpRateLimit });

    // Act
    const response = await request(app.getHttpServer())
      .post('/api/v1/enrollments/challenge')
      .send({ phoneNumber: '09123456789' });

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.data).toEqual({ phoneNumber: '09123456789' });
    expect(checkOtpRateLimit).toHaveBeenCalledTimes(1);
    expect(checkOtpRateLimit).toHaveBeenCalledWith(
      'neo-bank:enrollments:challenge:rate-limit:09123456789',
      5,
      60,
    );
    expect(issueOtp).toHaveBeenCalledTimes(1);
    const [otpKey, lockoutKey, challengeValue, ttl] = issueOtp.mock.calls[0];
    expect(otpKey).toBe('neo-bank:enrollments:challenge:otp:09123456789');
    expect(lockoutKey).toBe('neo-bank:enrollments:challenge:lockout:09123456789');
    // The stored value is `<challengeId>:<digest>` (ADR-019) — never the six-digit OTP.
    expect(challengeValue).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{64}$/,
    );
    expect(challengeValue).not.toMatch(/(^\d{6}$)|:\d{6}$/);
    expect(ttl).toBe(120);
    await close();
  });

  it('stores the OTP under the normalized phone number for a +98 country code', async () => {
    // Arrange
    const issueOtp = vi
      .fn<
        (
          otpKey: string,
          lockoutKey: string,
          challengeValue: string,
          ttlSeconds: number,
        ) => Promise<'issued' | 'exists' | 'locked'>
      >()
      .mockResolvedValue('issued');
    const checkOtpRateLimit = vi
      .fn<(rateLimitKey: string, maxSends: number, windowMinutes: number) => Promise<boolean>>()
      .mockResolvedValue(true);
    const { app, close } = await createTestAppWithMockRedis();
    overrideRedisService(app, { issueOtp, checkOtpRateLimit });

    // Act
    const response = await request(app.getHttpServer())
      .post('/api/v1/enrollments/challenge')
      .send({ phoneNumber: '+989123456789' });

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.data).toEqual({ phoneNumber: '09123456789' });
    expect(checkOtpRateLimit).toHaveBeenCalledWith(
      'neo-bank:enrollments:challenge:rate-limit:09123456789',
      5,
      60,
    );
    expect(issueOtp.mock.calls[0][0]).toBe('neo-bank:enrollments:challenge:otp:09123456789');
    expect(issueOtp.mock.calls[0][1]).toBe('neo-bank:enrollments:challenge:lockout:09123456789');
    await close();
  });

  it('rejects invalid phone numbers with Problem Details validation errors', async () => {
    // Arrange — each request uses a distinct X-Forwarded-For so the per-IP
    // rate limiter does not interfere (TRUST_PROXY=true in test env).
    const { app, close } = await createTestAppWithMockRedis();
    overrideRedisService(app, {
      issueOtp: vi.fn().mockResolvedValue('issued'),
      checkOtpRateLimit: vi.fn().mockResolvedValue(true),
    });
    const invalidPhoneNumbers = ['02112345678', '0912 345 678', '0912345678', ''];

    // Act + Assert
    for (let index = 0; index < invalidPhoneNumbers.length; index += 1) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/enrollments/challenge')
        .set('X-Forwarded-For', `198.51.100.${index + 10}`)
        .send({ phoneNumber: invalidPhoneNumbers[index] });

      expect(response.status).toBe(400);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.body.code).toBe('BAD_REQUEST');
      expect(response.body.detail).toContain('phoneNumber: ');
    }
    await close();
  });

  it('serves an application-error Problem Details response when OTP storage fails', async () => {
    // Arrange
    const { app, close } = await createTestAppWithMockRedis();
    overrideRedisService(app, {
      issueOtp: vi.fn().mockRejectedValue(new Error('connection lost')),
      checkOtpRateLimit: vi.fn().mockResolvedValue(true),
    });

    // Act
    const response = await request(app.getHttpServer())
      .post('/api/v1/enrollments/challenge')
      .send({ phoneNumber: '09123456789' });

    // Assert
    expect(response.status).toBe(500);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body.requestId).toBeTypeOf('string');
    await close();
  });

  it('serves a generic Problem Details response when the hourly OTP rate limit is exceeded', async () => {
    // Arrange
    const issueOtp = vi.fn().mockResolvedValue('issued' as 'issued' | 'exists' | 'locked');
    const checkOtpRateLimit = vi
      .fn<(rateLimitKey: string, maxSends: number, windowMinutes: number) => Promise<boolean>>()
      .mockResolvedValue(false);
    const { app, close } = await createTestAppWithMockRedis();
    overrideRedisService(app, { issueOtp, checkOtpRateLimit });

    // Act
    const response = await request(app.getHttpServer())
      .post('/api/v1/enrollments/challenge')
      .send({ phoneNumber: '09123456789' });

    // Assert — generic 400 without internal rate-limit details; OTP is never stored.
    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body.code).toBe('OTP_RATE_LIMIT_EXCEEDED');
    expect(response.body.detail).not.toMatch(/5|60|minute|hour|limit/i);
    expect(issueOtp).not.toHaveBeenCalled();
    await close();
  });

  it('serves the identical generic rate-limit response when a verification lockout is active (indistinguishable from the hourly quota)', async () => {
    // Arrange — the lockout result maps to the same client-facing error as the
    // hourly quota, so attackers cannot distinguish lockout from quota.
    const issueOtp = vi.fn().mockResolvedValue('locked' as const);
    const checkOtpRateLimit = vi
      .fn<(rateLimitKey: string, maxSends: number, windowMinutes: number) => Promise<boolean>>()
      .mockResolvedValue(true);
    const { app, close } = await createTestAppWithMockRedis();
    overrideRedisService(app, { issueOtp, checkOtpRateLimit });

    // Act
    const response = await request(app.getHttpServer())
      .post('/api/v1/enrollments/challenge')
      .send({ phoneNumber: '09123456789' });

    // Assert — same status, code, and detail shape as the hourly quota response.
    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body.code).toBe('OTP_RATE_LIMIT_EXCEEDED');
    expect(response.body.detail).not.toMatch(/lock|lockout|attempt/i);
    expect(issueOtp).toHaveBeenCalledTimes(1);
    await close();
  });

  it('serves a generic 500 when the rate limit check fails (Redis error)', async () => {
    // Arrange
    const { app, close } = await createTestAppWithMockRedis();
    overrideRedisService(app, {
      issueOtp: vi.fn().mockResolvedValue('issued'),
      checkOtpRateLimit: vi.fn().mockRejectedValue(new Error('connection lost')),
    });

    // Act
    const response = await request(app.getHttpServer())
      .post('/api/v1/enrollments/challenge')
      .send({ phoneNumber: '09123456789' });

    // Assert — infrastructure failure surfaces as generic 500, no Redis details.
    expect(response.status).toBe(500);
    expect(response.body.code).toBe('APPLICATION_ERROR');
    expect(response.body.detail).toBe('An unexpected error occurred.');
    expect(JSON.stringify(response.body)).not.toContain('connection lost');
    expect(JSON.stringify(response.body)).not.toContain('Redis');
    await close();
  });

  describe('POST /enrollments/verify', () => {
    function createAppWithVerifyMock(resolveResult: boolean | Error, storedValue?: string) {
      return createTestAppWithMockRedis().then(({ app, close }) => {
        const resolveOtpVerification =
          resolveResult instanceof Error
            ? vi.fn().mockRejectedValue(resolveResult)
            : vi.fn().mockResolvedValue(resolveResult);
        // The default stored value is a challenge (ID + digest) for the
        // correct OTP below, so the Node-side timing-safe comparison matches.
        const get = vi
          .fn<(key: string) => Promise<string | null>>()
          .mockResolvedValue(
            storedValue === undefined
              ? composeOtpChallengeValue(
                  randomUUID(),
                  computeOtpDigest('09123456789', '048391', _env.ENROLLMENTS_OTP_HMAC_SECRET),
                )
              : storedValue,
          );
        overrideRedisService(app, { get, resolveOtpVerification });
        return { app, close, resolveOtpVerification };
      });
    }

    it('verifies a correct OTP and returns only the phone number', async () => {
      // Arrange
      const { app, close, resolveOtpVerification } = await createAppWithVerifyMock(true);

      // Act
      const response = await request(app.getHttpServer())
        .post('/api/v1/enrollments/verify')
        .send({ phoneNumber: '09123456789', otp: '048391' });

      // Assert
      expect(response.status).toBe(201);
      expect(response.body.data).toEqual({ phoneNumber: '09123456789' });
      expect(JSON.stringify(response.body)).not.toContain('048391');
      expect(resolveOtpVerification).toHaveBeenCalledWith(
        'neo-bank:enrollments:challenge:otp:09123456789',
        'neo-bank:enrollments:challenge:attempts:09123456789',
        'neo-bank:enrollments:challenge:lockout:09123456789',
        expect.any(String),
        true,
        5,
        900,
      );
      await close();
    });

    it('normalizes the phone number before the Redis lookup', async () => {
      // Arrange — stored challenge is computed for the normalized number and
      // the submitted OTP, so the phone normalization is exercised end to end.
      const { app, close, resolveOtpVerification } = await createAppWithVerifyMock(
        true,
        composeOtpChallengeValue(
          randomUUID(),
          computeOtpDigest('09123456789', '000001', _env.ENROLLMENTS_OTP_HMAC_SECRET),
        ),
      );

      // Act
      const response = await request(app.getHttpServer())
        .post('/api/v1/enrollments/verify')
        .send({ phoneNumber: '+989123456789', otp: '000001' });

      // Assert
      expect(response.status).toBe(201);
      expect(response.body.data).toEqual({ phoneNumber: '09123456789' });
      expect(resolveOtpVerification).toHaveBeenCalledWith(
        'neo-bank:enrollments:challenge:otp:09123456789',
        'neo-bank:enrollments:challenge:attempts:09123456789',
        'neo-bank:enrollments:challenge:lockout:09123456789',
        expect.any(String),
        true,
        5,
        900,
      );
      await close();
    });

    it('returns the identical generic error for an incorrect and a missing or expired OTP', async () => {
      // Arrange — the Redis double cannot distinguish the two conditions;
      // both surface as the same consumed=false result, exactly as with a
      // real server, and must produce identical error responses.
      const { app: incorrectApp, close: closeIncorrect } = await createAppWithVerifyMock(false);
      const { app: missingApp, close: closeMissing } = await createAppWithVerifyMock(false);

      // Act
      const incorrect = await request(incorrectApp.getHttpServer())
        .post('/api/v1/enrollments/verify')
        .send({ phoneNumber: '09123456789', otp: '999999' });
      const missing = await request(missingApp.getHttpServer())
        .post('/api/v1/enrollments/verify')
        .send({ phoneNumber: '09123456789', otp: '111111' });

      // Assert
      expect(incorrect.status).toBe(400);
      expect(incorrect.headers['content-type']).toContain('application/problem+json');
      expect(incorrect.body.code).toBe('OTP_VERIFICATION_FAILED');
      // Identical client-facing contract: only the per-request members
      // (requestId, timestamp) may differ between two responses.
      expect(missing.body.detail).toBe(incorrect.body.detail);
      expect(missing.body.code).toBe(incorrect.body.code);
      expect(missing.body.title).toBe(incorrect.body.title);
      expect(missing.body.status).toBe(incorrect.body.status);
      expect(missing.body.type).toBe(incorrect.body.type);
      expect(missing.body.apiVersion).toBe(incorrect.body.apiVersion);
      expect(incorrect.body.detail).not.toContain('expired');
      expect(incorrect.body.detail).not.toContain('incorrect');
      await closeIncorrect();
      await closeMissing();
    });

    it('rejects an invalid phone number or OTP format before any Redis access', async () => {
      // Arrange — each request uses a distinct X-Forwarded-For so the per-IP
      // rate limiter does not interfere (TRUST_PROXY=true in test env).
      const { app, close, resolveOtpVerification } = await createAppWithVerifyMock(true);
      const invalidBodies = [
        { phone: '02112345678', otp: '048391' },
        { phone: '09123456789', otp: '48391' },
        { phone: '09123456789', otp: '48392a' },
        { phone: '09123456789', otp: 483_921 },
        { otp: '048391' },
        { phone: '09123456789' },
      ];

      // Act + Assert
      for (let index = 0; index < invalidBodies.length; index += 1) {
        const response = await request(app.getHttpServer())
          .post('/api/v1/enrollments/verify')
          .set('X-Forwarded-For', `198.51.100.${index + 1}`)
          .send(invalidBodies[index]);

        expect(response.status).toBe(400);
        expect(response.headers['content-type']).toContain('application/problem+json');
        expect(response.body.code).toBe('BAD_REQUEST');
      }
      expect(resolveOtpVerification).not.toHaveBeenCalled();
      await close();
    });

    it('serves a generic error without internal details when Redis fails', async () => {
      // Arrange
      const { app, close } = await createAppWithVerifyMock(new Error('connection lost'));

      // Act
      const response = await request(app.getHttpServer())
        .post('/api/v1/enrollments/verify')
        .send({ phoneNumber: '09123456789', otp: '048391' });

      // Assert — a generic 500 that says nothing about Redis.
      expect(response.status).toBe(500);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.body.code).toBe('APPLICATION_ERROR');
      expect(response.body.detail).toBe('An unexpected error occurred.');
      expect(JSON.stringify(response.body)).not.toContain('connection lost');
      expect(JSON.stringify(response.body)).not.toContain('Redis');
      await close();
    });
  });
});
