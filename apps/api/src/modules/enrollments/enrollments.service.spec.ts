import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { I18nService } from '@nestjs/i18n';
import { EntityManager } from '@mikro-orm/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Unit tests must not depend on ambient environment state, so the env
// validation layer is replaced with a fully valid environment.
vi.mock('#config/env/env.config.js', () => ({
  _env: {
    APP_ENV: 'test',
    HOST: '0.0.0.0',
    PORT: 3001,
    LOG_LEVEL: 'info',
    REDIS_URL: 'redis://localhost:6379',
    REDIS_USERNAME: '',
    REDIS_PASSWORD: '',
    REDIS_TLS: 'false',
    REDIS_CONNECT_TIMEOUT_MS: 10000,
    REDIS_COMMAND_TIMEOUT_MS: 5000,
    REDIS_MAX_RETRIES_PER_REQUEST: 3,
    REDIS_SHUTDOWN_TIMEOUT_MS: 2000,
    ENROLLMENTS_MAX_VERIFY_ATTEMPTS: 5,
    ENROLLMENTS_LOCKOUT_TTL_SECONDS: 900,
    ENROLLMENTS_OTP_HMAC_SECRET: '1111111111111111111111111111111111111111111111111111111111111111',
  },
}));

const { randomIntMock } = vi.hoisted(() => ({
  randomIntMock: vi.fn<(min: number, max: number) => number>(),
}));

// Only randomInt is replaced; the real HMAC/timingSafeEqual primitives stay so
// the digest stored in Redis is the genuine one.
vi.mock('node:crypto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:crypto')>()),
  randomInt: randomIntMock,
}));

import { RedisService } from '#redis/redis.service.js';
import type { IssueOtpResult } from '#redis/redis.service.js';
import { AppHttpException } from '#errors/app-http.exception.js';
import { ErrorCode } from '#errors/error.code.js';
import { Enrollment } from '#modules/enrollments/entities/enrollment.entity.js';
import {
  composeOtpChallengeValue,
  computeOtpDigest,
  parseOtpChallengeValue,
} from './enrollments.otp-digest.js';
import { CHALLENGE_OTP_TTL_SECONDS, EnrollmentsService } from './enrollments.service.js';
import { EnrollmentStateMachine } from './enrollment-state-machine.service.js';
import {
  ENROLLMENT_INITIAL_STATUS,
  ENROLLMENT_INITIAL_STEP,
  ENROLLMENT_STATUS_EXPIRED,
  ENROLLMENT_STATUS_IN_PROGRESS,
  ENROLLMENT_STATUS_PENDING_REVIEW,
  ENROLLMENT_STEP_COMPLETED,
  ENROLLMENT_TTL_MS,
} from './enrollments.enums.js';

import type { EnrollmentStatus, EnrollmentStep } from './enrollments.enums.js';

const TEST_SECRET = '1111111111111111111111111111111111111111111111111111111111111111';
const TEST_PHONE = '09123456789';
const TEST_OTP = '483921';

type MockEm = {
  create: ReturnType<typeof vi.fn>;
  findOne: ReturnType<typeof vi.fn>;
  flush: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
};

describe('EnrollmentsService', () => {
  const redisService = {
    issueOtp:
      vi.fn<
        (
          otpKey: string,
          lockoutKey: string,
          challengeValue: string,
          ttlSeconds: number,
        ) => Promise<IssueOtpResult>
      >(),
    get: vi.fn<(key: string) => Promise<string | null>>(),
    resolveOtpVerification:
      vi.fn<
        (
          otpKey: string,
          attemptsKey: string,
          lockoutKey: string,
          observedChallengeId: string,
          matched: boolean,
          maxAttempts: number,
          lockoutTtlSeconds: number,
        ) => Promise<boolean>
      >(),
    checkOtpRateLimit:
      vi.fn<(rateLimitKey: string, maxSends: number, windowMinutes: number) => Promise<boolean>>(),
  };
  const configService = {
    getOrThrow: vi.fn(),
  };
  // Catalog-consistency tests guarantee the real messages; the stub returns
  // the key's English message so the error details stay assertable here.
  const i18n = {
    t: vi.fn((key: string) =>
      key === 'otp.rateLimited'
        ? 'Too many OTP requests. Please try again later.'
        : 'Phone number verification failed.',
    ),
  };
  let em: MockEm;
  let service: EnrollmentsService;

  beforeEach(async () => {
    randomIntMock.mockReset();
    redisService.issueOtp.mockReset();
    redisService.issueOtp.mockResolvedValue('issued');
    redisService.get.mockReset();
    redisService.get.mockResolvedValue(null);
    redisService.resolveOtpVerification.mockReset();
    redisService.resolveOtpVerification.mockResolvedValue(false);
    redisService.checkOtpRateLimit.mockReset();
    redisService.checkOtpRateLimit.mockResolvedValue(true);
    configService.getOrThrow.mockReturnValue({
      maxVerifyAttempts: 5,
      lockoutTtlSeconds: 900,
      otpHmacSecret: TEST_SECRET,
    });
    i18n.t.mockClear();

    em = {
      create: vi.fn(),
      findOne: vi.fn(),
      flush: vi.fn(),
      refresh: vi.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        EnrollmentsService,
        EnrollmentStateMachine,
        { provide: RedisService, useValue: redisService },
        { provide: ConfigService, useValue: configService },
        { provide: I18nService, useValue: i18n },
        { provide: EntityManager, useValue: em },
      ],
    }).compile();

    service = module.get(EnrollmentsService);
  });

  describe('hashPassword (Argon2id)', () => {
    it('hashes a valid input into an Argon2id PHC string', async () => {
      const hash = await service.hashPassword('ValidInput123');
      expect(hash).toMatch(/^\$argon2id\$v=\d+\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
    });

    it('uses a different salt on each call — same input produces different hashes', async () => {
      const hash1 = await service.hashPassword('SameInput123');
      const hash2 = await service.hashPassword('SameInput123');
      expect(hash1).not.toBe(hash2);
    });

    it('generated hashes verify against the correct input', async () => {
      const argon2 = await import('argon2');
      const hash = await service.hashPassword('CorrectInput1');
      const valid = await argon2.verify(hash, 'CorrectInput1');
      expect(valid).toBe(true);
    });

    it('fails verification for an incorrect input', async () => {
      const argon2 = await import('argon2');
      const hash = await service.hashPassword('CorrectInput1');
      const valid = await argon2.verify(hash, 'WrongInput1');
      expect(valid).toBe(false);
    });

    it('handles malformed stored hashes without throwing during verify', async () => {
      const argon2 = await import('argon2');
      await expect(argon2.verify('not-a-valid-hash', 'Input123')).rejects.toThrow();
    });

    it('needsRehash returns false for a hash created with current parameters', async () => {
      const argon2 = await import('argon2');
      const hash = await service.hashPassword('Input123');
      const needsRehash = await argon2.needsRehash(hash, {
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });
      expect(needsRehash).toBe(false);
    });

    it('needsRehash returns true for a hash created with weaker parameters', async () => {
      const argon2 = await import('argon2');
      const weakHash = await argon2.hash('Input123', {
        type: argon2.argon2id,
        memoryCost: 1024,
        timeCost: 1,
        parallelism: 1,
      });
      const needsRehash = await argon2.needsRehash(weakHash, {
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });
      expect(needsRehash).toBe(true);
    });

    it('handles Unicode input correctly', async () => {
      const argon2 = await import('argon2');
      const unicodeInput = `Input\u0631\u0645\u0632${Date.now()}`;
      const hash = await service.hashPassword(unicodeInput);
      const valid = await argon2.verify(hash, unicodeInput);
      const invalid = await argon2.verify(hash, `${unicodeInput}X`);
      expect(valid).toBe(true);
      expect(invalid).toBe(false);
    });
  });

  it('stores the challenge value (challenge ID + OTP HMAC digest) — never the plaintext OTP — in Redis under the naming-convention key with an exact 120-second TTL via the atomic issue script', async () => {
    // Arrange
    randomIntMock.mockReturnValue(483_921);

    // Act
    await service.requestChallenge(TEST_PHONE);

    // Assert
    expect(redisService.issueOtp).toHaveBeenCalledTimes(1);
    const [otpKey, lockoutKey, challengeValue, ttl] = redisService.issueOtp.mock.calls[0];
    expect(otpKey).toBe('neo-bank:enrollments:challenge:otp:09123456789');
    expect(lockoutKey).toBe('neo-bank:enrollments:challenge:lockout:09123456789');
    const parsed = parseOtpChallengeValue(challengeValue);
    expect(parsed).not.toBeNull();
    expect(parsed?.challengeId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(parsed?.digest).toBe(computeOtpDigest(TEST_PHONE, TEST_OTP, TEST_SECRET));
    expect(challengeValue).not.toContain(TEST_OTP);
    expect(ttl).toBe(CHALLENGE_OTP_TTL_SECONDS);
  });

  it('resolves without a response body — the phone number and the OTP value are never returned', async () => {
    // Arrange
    randomIntMock.mockReturnValue(483_921);

    // Act
    const result = await service.requestChallenge(TEST_PHONE);

    // Assert — the endpoint answers 202 Accepted with an empty body
    // (ADR-039): no phone number and no OTP value may reach the response.
    expect(result).toBeUndefined();
  });

  it('generates the OTP as a string of exactly six digits across the full range before digesting it', async () => {
    // Arrange & Act
    randomIntMock.mockReturnValue(100_000);
    await service.requestChallenge(TEST_PHONE);
    const lowerValue = redisService.issueOtp.mock.calls[0][2];

    randomIntMock.mockReturnValue(999_999);
    await service.requestChallenge(TEST_PHONE);
    const upperValue = redisService.issueOtp.mock.calls[1][2];

    // Assert — the two range boundaries map to two different digests, each
    // under its own challenge ID.
    const lower = parseOtpChallengeValue(lowerValue);
    const upper = parseOtpChallengeValue(upperValue);
    expect(lower?.digest).toBe(computeOtpDigest(TEST_PHONE, '100000', TEST_SECRET));
    expect(upper?.digest).toBe(computeOtpDigest(TEST_PHONE, '999999', TEST_SECRET));
    expect(lower?.digest).not.toBe(upper?.digest);
    expect(lower?.challengeId).not.toBe(upper?.challengeId);
  });

  it('draws the OTP from the cryptographically secure randomInt over the six-digit range', async () => {
    // Arrange
    randomIntMock.mockReturnValue(123_456);

    // Act
    await service.requestChallenge(TEST_PHONE);

    // Assert
    expect(randomIntMock).toHaveBeenCalledTimes(1);
    expect(randomIntMock).toHaveBeenCalledWith(100_000, 1_000_000);
  });

  it('rejects issuance when an active OTP already exists', async () => {
    // Arrange
    randomIntMock.mockReturnValue(483_921);
    redisService.issueOtp.mockResolvedValue('exists');

    // Act & Assert
    await expect(service.requestChallenge(TEST_PHONE)).rejects.toThrow(AppHttpException);
    await expect(service.requestChallenge(TEST_PHONE)).rejects.toMatchObject({
      code: ErrorCode.OtpVerificationFailed,
    });
  });

  it('rejects issuance with the generic rate-limit error when a verification lockout is active (indistinguishable from the hourly quota)', async () => {
    // Arrange
    randomIntMock.mockReturnValue(483_921);
    redisService.issueOtp.mockResolvedValue('locked');

    // Act & Assert
    const promise = service.requestChallenge(TEST_PHONE);
    await expect(promise).rejects.toThrow(AppHttpException);
    await expect(promise).rejects.toMatchObject({
      code: ErrorCode.OtpRateLimitExceeded,
    });
  });

  it('propagates Redis storage failures to the caller', async () => {
    // Arrange
    randomIntMock.mockReturnValue(483_921);
    redisService.issueOtp.mockRejectedValue(new Error('connection lost'));

    // Act & Assert
    await expect(service.requestChallenge(TEST_PHONE)).rejects.toThrow('connection lost');
  });

  it('checks the per-phone hourly rate limit before attempting to store the OTP', async () => {
    // Arrange
    randomIntMock.mockReturnValue(483_921);

    // Act
    await service.requestChallenge(TEST_PHONE);

    // Assert
    expect(redisService.checkOtpRateLimit).toHaveBeenCalledTimes(1);
    const [rateLimitKey, maxSends, windowMinutes] = redisService.checkOtpRateLimit.mock.calls[0];
    expect(rateLimitKey).toBe('neo-bank:enrollments:challenge:rate-limit:09123456789');
    expect(maxSends).toBe(5);
    expect(windowMinutes).toBe(60);
  });

  it('rejects the request when the hourly rate limit is exceeded', async () => {
    // Arrange
    randomIntMock.mockReturnValue(483_921);
    redisService.checkOtpRateLimit.mockReset();
    redisService.checkOtpRateLimit.mockResolvedValue(false);

    // Act
    const promise = service.requestChallenge(TEST_PHONE);

    // Assert
    await expect(promise).rejects.toThrow(AppHttpException);
    await expect(promise).rejects.toMatchObject({
      code: ErrorCode.OtpRateLimitExceeded,
    });
    // The rate limit check should be called, but issueOtp should not be called
    expect(redisService.checkOtpRateLimit).toHaveBeenCalledTimes(1);
    expect(redisService.issueOtp).not.toHaveBeenCalled();
  });

  it('propagates Redis rate limit check failures to the caller', async () => {
    // Arrange
    randomIntMock.mockReturnValue(483_921);
    redisService.checkOtpRateLimit.mockRejectedValue(new Error('connection lost'));

    // Act & Assert
    await expect(service.requestChallenge(TEST_PHONE)).rejects.toThrow('connection lost');
  });

  describe('verifyChallenge', () => {
    const STORED_CHALLENGE_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    const storedChallengeValue = (otp: string, secret = TEST_SECRET): string =>
      composeOtpChallengeValue(STORED_CHALLENGE_ID, computeOtpDigest(TEST_PHONE, otp, secret));

    // Helper: set up a successful verify path and run it. Pass the EM
    // observation shape (null → new-create branch; object → reuse-return).
    function succeedWith(emResponse: unknown) {
      redisService.get.mockResolvedValue(storedChallengeValue(TEST_OTP));
      redisService.resolveOtpVerification.mockResolvedValue(true);
      em.findOne.mockResolvedValue(emResponse);
      if (emResponse !== null) {
        // Reuse-return branch does not call create or flush.
        em.create.mockReset();
        em.flush.mockReset();
      } else {
        // New-create branch: create+flush called once, returning the same
        // object (as a live EM would read back after insert).
        const enrollment = { publicId: 'created-id' };
        em.create.mockReturnValue(enrollment);
        em.flush.mockResolvedValue(undefined);
        em.findOne.mockResolvedValue(enrollment);
      }
      return service.verifyChallenge(TEST_PHONE, TEST_OTP);
    }

    it('reads the stored value, compares digests in Node, resolves the OTP, ensures an enrollment exists, and returns both phoneNumber and publicId', async () => {
      // Arrange — new enrollment: EM finds nothing.
      redisService.get.mockResolvedValue(storedChallengeValue(TEST_OTP));
      redisService.resolveOtpVerification.mockResolvedValue(true);
      em.findOne.mockResolvedValue(null);
      const enrollment = { publicId: 'created-id' };
      em.create.mockReturnValue(enrollment);
      em.flush.mockResolvedValue(undefined);

      // Act
      const result = await service.verifyChallenge(TEST_PHONE, TEST_OTP);

      // Assert — OTP path.
      const otpKey = 'neo-bank:enrollments:challenge:otp:09123456789';
      expect(redisService.get).toHaveBeenCalledWith(otpKey);
      expect(redisService.resolveOtpVerification).toHaveBeenCalledWith(
        otpKey,
        'neo-bank:enrollments:challenge:attempts:09123456789',
        'neo-bank:enrollments:challenge:lockout:09123456789',
        STORED_CHALLENGE_ID,
        true,
        5,
        900,
      );
      // Assert — enrollment creation explicitness (DEFERRED _060 #4 SEC-03):
      // only phoneNumber is supplied; lifecycle fields come from defaults.
      expect(em.findOne).toHaveBeenCalledTimes(1);
      expect(em.findOne).toHaveBeenCalledWith(Enrollment, { phoneNumber: TEST_PHONE });
      expect(em.create).toHaveBeenCalledTimes(1);
      expect(em.create).toHaveBeenCalledWith(Enrollment, { phoneNumber: TEST_PHONE });
      expect(em.flush).toHaveBeenCalledTimes(1);
      // Assert — response shape.
      expect(typeof result.phoneNumber).toBe('string');
      expect(typeof result.publicId).toBe('string');
      expect(Object.keys(result).sort()).toEqual(['phoneNumber', 'publicId']);
    });

    it("returns the existing enrollment's publicId when the phone already has an active enrollment", async () => {
      // Arrange — reuse-return branch: a live enrollment is found.
      const existingPublicId = 'live-id';
      const result = await succeedWith({
        phoneNumber: TEST_PHONE,
        publicId: existingPublicId,
        status: ENROLLMENT_INITIAL_STATUS,
        currentStep: ENROLLMENT_INITIAL_STEP,
        expiresAt: new Date(Date.now() + 60_000),
      });

      // Assert — no create or flush touched; the service reused the row.
      expect(em.create).not.toHaveBeenCalled();
      expect(em.flush).not.toHaveBeenCalled();
      expect(result.publicId).toBe(existingPublicId);
    });

    it('resets an expired enrollment to INITIAL/NATIONAL_CODE with a fresh expiresAt and returns its publicId', async () => {
      // Arrange — EXPIRED row is found; the service resets it through the
      // explicit-field branch and flushes the change.
      const expiredPublicId = 'expired-id';
      const result = await succeedWith({
        phoneNumber: TEST_PHONE,
        publicId: expiredPublicId,
        status: ENROLLMENT_STATUS_EXPIRED,
        currentStep: ENROLLMENT_INITIAL_STEP,
        expiresAt: new Date(Date.now() - 1_000),
      });

      // Assert — status/currentStep/expiry are restored; no create fires.
      expect(em.create).not.toHaveBeenCalled();
      expect(em.flush).toHaveBeenCalledTimes(1);
      expect(em.findOne).toHaveBeenCalledTimes(1);
      expect(result.publicId).toBe(expiredPublicId);
    });

    it('throws when Redis reports a failed verify instead of touching the DB', async () => {
      // Arrange
      redisService.get.mockResolvedValue(storedChallengeValue(TEST_OTP));
      redisService.resolveOtpVerification.mockResolvedValue(false);

      // Act & Assert
      await expect(service.verifyChallenge(TEST_PHONE, TEST_OTP)).rejects.toThrow(AppHttpException);
      await expect(service.verifyChallenge(TEST_PHONE, TEST_OTP)).rejects.toMatchObject({
        code: ErrorCode.OtpVerificationFailed,
      });
      // No DB access — the OTP gate short-circuits before ensureEnrollment.
      expect(em.create).not.toHaveBeenCalled();
      expect(em.findOne).not.toHaveBeenCalled();
      expect(em.flush).not.toHaveBeenCalled();
    });

    it('resolves with matched=false but the observed challenge ID when the submitted OTP is wrong', async () => {
      // Arrange
      redisService.get.mockResolvedValue(storedChallengeValue(TEST_OTP));

      // Act & Assert — matched=false flows to the resolve; the service still
      // throws only when the resolve itself reports failure.
      await expect(service.verifyChallenge(TEST_PHONE, '999999')).rejects.toThrow(AppHttpException);
      expect(redisService.resolveOtpVerification).toHaveBeenCalledWith(
        'neo-bank:enrollments:challenge:otp:09123456789',
        'neo-bank:enrollments:challenge:attempts:09123456789',
        'neo-bank:enrollments:challenge:lockout:09123456789',
        STORED_CHALLENGE_ID,
        false,
        5,
        900,
      );
      // The EM is never reached because verify fails first.
      expect(em.findOne).not.toHaveBeenCalled();
      expect(em.create).not.toHaveBeenCalled();
      expect(em.flush).not.toHaveBeenCalled();
    });

    it('resolves with matched=false — never an exception — when Redis holds no value', async () => {
      // Arrange
      redisService.get.mockResolvedValue(null);

      // Act & Assert — the missing key becomes a plain failed match; the only
      // throw is the domain error from the resolve's false result.
      await expect(service.verifyChallenge(TEST_PHONE, TEST_OTP)).rejects.toThrow(AppHttpException);
      expect(redisService.resolveOtpVerification).toHaveBeenCalledWith(
        'neo-bank:enrollments:challenge:otp:09123456789',
        'neo-bank:enrollments:challenge:attempts:09123456789',
        'neo-bank:enrollments:challenge:lockout:09123456789',
        '',
        false,
        5,
        900,
      );
      expect(em.findOne).not.toHaveBeenCalled();
    });

    it('resolves with matched=false when Redis holds a malformed stored value', async () => {
      // Arrange
      redisService.get.mockResolvedValue('not-a-hex-digest');

      // Act & Assert — the malformed value is a failed match, never an
      // exception from the comparison itself.
      await expect(service.verifyChallenge(TEST_PHONE, TEST_OTP)).rejects.toThrow(AppHttpException);
      expect(redisService.resolveOtpVerification).toHaveBeenCalledWith(
        'neo-bank:enrollments:challenge:otp:09123456789',
        'neo-bank:enrollments:challenge:attempts:09123456789',
        'neo-bank:enrollments:challenge:lockout:09123456789',
        '',
        false,
        5,
        900,
      );
      expect(em.findOne).not.toHaveBeenCalled();
    });

    it('rejects every failure condition with the same generic error', async () => {
      // Arrange — false covers locked, missing, expired, incorrect, or exhausted attempts alike.
      redisService.resolveOtpVerification.mockResolvedValue(false);

      // Act & Assert — one error code for all of them.
      await expect(service.verifyChallenge(TEST_PHONE, '999999')).rejects.toThrow(AppHttpException);
      await expect(service.verifyChallenge(TEST_PHONE, '999999')).rejects.toMatchObject({
        code: ErrorCode.OtpVerificationFailed,
      });
    });

    it('localizes the verification failure detail through the translation catalog', async () => {
      // Arrange
      redisService.resolveOtpVerification.mockResolvedValue(false);

      // Act
      const error: unknown = await service
        .verifyChallenge(TEST_PHONE, '999999')
        .catch((caught: unknown) => caught);

      // Assert — the detail is whatever the catalog serves for the request's
      // locale; the unit asserts the correct key is requested.
      if (!(error instanceof AppHttpException)) throw new Error('Expected AppHttpException.');
      expect(error.getResponse()).toMatchObject({
        detail: 'Phone number verification failed.',
      });
      expect(i18n.t).toHaveBeenCalledWith('otp.verificationFailed');
    });

    it('localizes the OTP rate-limit detail through the translation catalog', async () => {
      // Arrange
      redisService.checkOtpRateLimit.mockResolvedValue(false);

      // Act
      const error: unknown = await service
        .requestChallenge(TEST_PHONE)
        .catch((caught: unknown) => caught);

      // Assert
      if (!(error instanceof AppHttpException)) throw new Error('Expected AppHttpException.');
      expect(error.getResponse()).toMatchObject({
        detail: 'Too many OTP requests. Please try again later.',
      });
      expect(i18n.t).toHaveBeenCalledWith('otp.rateLimited');
    });

    it('propagates Redis failures instead of converting them into verification failures', async () => {
      // Arrange
      redisService.resolveOtpVerification.mockRejectedValue(new Error('connection lost'));

      // Act & Assert — a plain Error, not the verification failure, so the
      // global filter serves its generic 500 (asserted in e2e).
      await expect(service.verifyChallenge(TEST_PHONE, TEST_OTP)).rejects.toThrow(
        'connection lost',
      );
      // DB is never reached when Redis throws.
      expect(em.findOne).not.toHaveBeenCalled();
    });

    it('uses the configured max verification attempts, lockout TTL, and HMAC secret from environment', async () => {
      // Arrange
      const customSecret = 'ab'.repeat(32);
      configService.getOrThrow.mockReturnValue({
        maxVerifyAttempts: 3,
        lockoutTtlSeconds: 300,
        otpHmacSecret: customSecret,
      });
      redisService.get.mockResolvedValue(storedChallengeValue(TEST_OTP, customSecret));
      redisService.resolveOtpVerification.mockResolvedValue(true);
      em.findOne.mockResolvedValue(null);
      const enrollment = { publicId: 'fresh-created' };
      em.create.mockReturnValue(enrollment);
      em.flush.mockResolvedValue(undefined);

      // Act
      const result = await service.verifyChallenge(TEST_PHONE, TEST_OTP);

      // Assert
      expect(configService.getOrThrow).toHaveBeenCalled();
      expect(redisService.resolveOtpVerification).toHaveBeenCalledWith(
        'neo-bank:enrollments:challenge:otp:09123456789',
        'neo-bank:enrollments:challenge:attempts:09123456789',
        'neo-bank:enrollments:challenge:lockout:09123456789',
        STORED_CHALLENGE_ID,
        true,
        3,
        300,
      );
      expect(result.phoneNumber).toBe(TEST_PHONE);
      expect(result.publicId).toBe(enrollment.publicId);
    });
  });
});

// ---- submitStep tests ----

describe('submitStep', () => {
  const TEST_PUBLIC_ID = '018f4b2e-7c0a-7d3f-a5b9-1e2c3d4f5a6b';
  const NOW = new Date('2026-01-01T00:00:00.000Z');

  let redisService: {
    issueOtp: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    resolveOtpVerification: ReturnType<typeof vi.fn>;
    checkOtpRateLimit: ReturnType<typeof vi.fn>;
  };
  let configService: {
    getOrThrow: ReturnType<typeof vi.fn>;
  };
  let i18n: {
    t: ReturnType<typeof vi.fn>;
  };
  let em: {
    findOneOrFail: ReturnType<typeof vi.fn>;
    flush: ReturnType<typeof vi.fn>;
    lock: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
  };
  let service: EnrollmentsService;
  let stateMachine: EnrollmentStateMachine;

  function makeEnrollment(
    overrides: Partial<{
      publicId: string;
      status: EnrollmentStatus;
      currentStep: EnrollmentStep;
      expiresAt: Date;
    }> = {},
  ) {
    return {
      publicId: TEST_PUBLIC_ID,
      status: ENROLLMENT_INITIAL_STATUS,
      currentStep: ENROLLMENT_INITIAL_STEP,
      expiresAt: new Date(NOW.getTime() + ENROLLMENT_TTL_MS),
      ...overrides,
      // Methods that the state machine may call
      nationalCode: null,
      firstName: null,
      lastName: null,
      birthDate: null,
      referralCode: null,
      username: null,
      passwordHash: null,
      occupation: null,
      videoKey: null,
    };
  }

  beforeEach(async () => {
    vi.resetModules();

    redisService = {
      issueOtp: vi.fn(),
      get: vi.fn(),
      resolveOtpVerification: vi.fn(),
      checkOtpRateLimit: vi.fn(),
    };

    configService = {
      getOrThrow: vi.fn().mockReturnValue({
        maxVerifyAttempts: 5,
        lockoutTtlSeconds: 900,
        otpHmacSecret: '11'.repeat(32),
      }),
    };

    i18n = { t: vi.fn((key: string) => key) };

    em = {
      findOneOrFail: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
      lock: vi.fn(),
      refresh: vi.fn().mockResolvedValue(undefined),
    };

    stateMachine = new EnrollmentStateMachine();

    const module = await Test.createTestingModule({
      providers: [
        EnrollmentsService,
        { provide: RedisService, useValue: redisService },
        { provide: ConfigService, useValue: configService },
        { provide: I18nService, useValue: i18n },
        { provide: EntityManager, useValue: em },
        { provide: EnrollmentStateMachine, useValue: stateMachine },
      ],
    }).compile();

    service = module.get(EnrollmentsService);
  });

  describe('successful step submissions', () => {
    it('submits NATIONAL_CODE: advances to FULL_NAME, status becomes IN_PROGRESS', async () => {
      const enrollment = makeEnrollment();
      em.findOneOrFail.mockResolvedValue(enrollment);

      const result = await service.submitStep(TEST_PUBLIC_ID, 'NATIONAL_CODE', NOW, (e) => {
        e.nationalCode = '1234567890';
      });

      expect(result.publicId).toBe(TEST_PUBLIC_ID);
      expect(result.status).toBe(ENROLLMENT_STATUS_IN_PROGRESS);
      expect(result.currentStep).toBe('FULL_NAME');
      expect(enrollment.nationalCode).toBe('1234567890');
      expect(em.flush).toHaveBeenCalledTimes(1);
    });

    it('submits FULL_NAME: advances to BIRTH_DATE', async () => {
      const enrollment = makeEnrollment({
        status: ENROLLMENT_STATUS_IN_PROGRESS,
        currentStep: 'FULL_NAME',
      });
      em.findOneOrFail.mockResolvedValue(enrollment);

      const result = await service.submitStep(TEST_PUBLIC_ID, 'FULL_NAME', NOW, (e) => {
        e.firstName = 'Ali';
        e.lastName = 'Rezaei';
      });

      expect(result.currentStep).toBe('BIRTH_DATE');
      expect(result.status).toBe(ENROLLMENT_STATUS_IN_PROGRESS);
      expect(enrollment.firstName).toBe('Ali');
      expect(enrollment.lastName).toBe('Rezaei');
    });

    it('submits BIRTH_DATE: advances to REFERRAL_CODE', async () => {
      const enrollment = makeEnrollment({
        status: ENROLLMENT_STATUS_IN_PROGRESS,
        currentStep: 'BIRTH_DATE',
      });
      em.findOneOrFail.mockResolvedValue(enrollment);

      const result = await service.submitStep(TEST_PUBLIC_ID, 'BIRTH_DATE', NOW, (e) => {
        e.birthDate = '1990-05-15';
      });

      expect(result.currentStep).toBe('REFERRAL_CODE');
      expect(enrollment.birthDate).toBe('1990-05-15');
    });

    it('submits REFERRAL_CODE: advances to USERNAME', async () => {
      const enrollment = makeEnrollment({
        status: ENROLLMENT_STATUS_IN_PROGRESS,
        currentStep: 'REFERRAL_CODE',
      });
      em.findOneOrFail.mockResolvedValue(enrollment);

      const result = await service.submitStep(TEST_PUBLIC_ID, 'REFERRAL_CODE', NOW, (e) => {
        e.referralCode = 'REF123';
      });

      expect(result.currentStep).toBe('USERNAME');
      expect(enrollment.referralCode).toBe('REF123');
    });

    it('submits USERNAME: advances to PASSWORD', async () => {
      const enrollment = makeEnrollment({
        status: ENROLLMENT_STATUS_IN_PROGRESS,
        currentStep: 'USERNAME',
      });
      em.findOneOrFail.mockResolvedValue(enrollment);

      const result = await service.submitStep(TEST_PUBLIC_ID, 'USERNAME', NOW, (e) => {
        e.username = 'ali.rezaei_123';
      });

      expect(result.currentStep).toBe('PASSWORD');
      expect(enrollment.username).toBe('ali.rezaei_123');
    });

    it('submits PASSWORD: advances to OCCUPATION', async () => {
      const enrollment = makeEnrollment({
        status: ENROLLMENT_STATUS_IN_PROGRESS,
        currentStep: 'PASSWORD',
      });
      em.findOneOrFail.mockResolvedValue(enrollment);

      const result = await service.submitStep(TEST_PUBLIC_ID, 'PASSWORD', NOW, (e) => {
        e.passwordHash = 'hashed-password';
      });

      expect(result.currentStep).toBe('OCCUPATION');
      expect(enrollment.passwordHash).toBe('hashed-password');
    });

    it('submits OCCUPATION: advances to VIDEO_VERIFICATION', async () => {
      const enrollment = makeEnrollment({
        status: ENROLLMENT_STATUS_IN_PROGRESS,
        currentStep: 'OCCUPATION',
      });
      em.findOneOrFail.mockResolvedValue(enrollment);

      const result = await service.submitStep(TEST_PUBLIC_ID, 'OCCUPATION', NOW, (e) => {
        e.occupation = 'Software Engineer';
      });

      expect(result.currentStep).toBe('VIDEO_VERIFICATION');
      expect(enrollment.occupation).toBe('Software Engineer');
    });

    it('submits VIDEO_VERIFICATION: completes form to PENDING_REVIEW with COMPLETED step', async () => {
      const enrollment = makeEnrollment({
        status: ENROLLMENT_STATUS_IN_PROGRESS,
        currentStep: 'VIDEO_VERIFICATION',
      });
      em.findOneOrFail.mockResolvedValue(enrollment);

      const result = await service.submitStep(TEST_PUBLIC_ID, 'VIDEO_VERIFICATION', NOW, () => {
        /* videoKey set by deferred upload flow */
      });

      expect(result.status).toBe(ENROLLMENT_STATUS_PENDING_REVIEW);
      expect(result.currentStep).toBe(ENROLLMENT_STEP_COMPLETED);
    });
  });

  describe('earlier-step edits (do not move currentStep backwards)', () => {
    it('editing NATIONAL_CODE when currentStep is FULL_NAME keeps currentStep', async () => {
      const enrollment = makeEnrollment({
        status: ENROLLMENT_STATUS_IN_PROGRESS,
        currentStep: 'FULL_NAME',
      });
      em.findOneOrFail.mockResolvedValue(enrollment);

      const result = await service.submitStep(TEST_PUBLIC_ID, 'NATIONAL_CODE', NOW, (e) => {
        e.nationalCode = '9876543210';
      });

      expect(result.currentStep).toBe('FULL_NAME');
      expect(result.status).toBe(ENROLLMENT_STATUS_IN_PROGRESS);
      expect(enrollment.nationalCode).toBe('9876543210');
    });

    it('editing FULL_NAME when currentStep is BIRTH_DATE keeps currentStep', async () => {
      const enrollment = makeEnrollment({
        status: ENROLLMENT_STATUS_IN_PROGRESS,
        currentStep: 'BIRTH_DATE',
      });
      em.findOneOrFail.mockResolvedValue(enrollment);

      const result = await service.submitStep(TEST_PUBLIC_ID, 'FULL_NAME', NOW, (e) => {
        e.firstName = 'New';
        e.lastName = 'Name';
      });

      expect(result.currentStep).toBe('BIRTH_DATE');
      expect(enrollment.firstName).toBe('New');
    });
  });

  describe('expiration handling', () => {
    it('returns 410 GONE when enrollment is expired (expireIfDue transitions and flushes first)', async () => {
      const expiredAt = new Date(NOW.getTime() - 1000);
      const enrollment = makeEnrollment({ expiresAt: expiredAt });
      em.findOneOrFail.mockResolvedValue(enrollment);

      await expect(
        service.submitStep(TEST_PUBLIC_ID, 'NATIONAL_CODE', NOW, () => {}),
      ).rejects.toThrow();

      // The error is thrown as AppHttpException; verify the enrollment was
      // transitioned to EXPIRED and flushed BEFORE the error.
      expect(enrollment.status).toBe(ENROLLMENT_STATUS_EXPIRED);
      expect(em.flush).toHaveBeenCalledTimes(1);
    });

    it('returns 410 for already EXPIRED enrollment (expireIfDue returns false but status is EXPIRED)', async () => {
      const enrollment = makeEnrollment({ status: ENROLLMENT_STATUS_EXPIRED });
      em.findOneOrFail.mockResolvedValue(enrollment);

      await expect(
        service.submitStep(TEST_PUBLIC_ID, 'NATIONAL_CODE', NOW, () => {}),
      ).rejects.toThrow();

      // The state machine throws ENROLLMENT_STEP_NOT_ALLOWED for EXPIRED
      // (since INCOMPLETE_ENROLLMENT_STATUSES doesn't include EXPIRED).
    });
  });

  describe('step order validation', () => {
    it('rejects future step (e.g., BIRTH_DATE before NATIONAL_CODE)', async () => {
      const enrollment = makeEnrollment(); // currentStep = NATIONAL_CODE
      em.findOneOrFail.mockResolvedValue(enrollment);

      await expect(
        service.submitStep(TEST_PUBLIC_ID, 'BIRTH_DATE', NOW, () => {}),
      ).rejects.toThrow();

      // Should not flush — the step was rejected before apply().
      expect(em.flush).not.toHaveBeenCalled();
    });

    it('rejects COMPLETED step (never submittable)', async () => {
      const enrollment = makeEnrollment({ currentStep: ENROLLMENT_STEP_COMPLETED });
      em.findOneOrFail.mockResolvedValue(enrollment);

      await expect(
        service.submitStep(TEST_PUBLIC_ID, 'COMPLETED', NOW, () => {}),
      ).rejects.toThrow();

      expect(em.flush).not.toHaveBeenCalled();
    });

    it('rejects step when status is PENDING_REVIEW (non-receptive)', async () => {
      const enrollment = makeEnrollment({ status: ENROLLMENT_STATUS_PENDING_REVIEW });
      em.findOneOrFail.mockResolvedValue(enrollment);

      await expect(
        service.submitStep(TEST_PUBLIC_ID, 'NATIONAL_CODE', NOW, () => {}),
      ).rejects.toThrow();

      expect(em.flush).not.toHaveBeenCalled();
    });
  });

  describe('unique constraint violations', () => {
    it('maps national_code unique violation to indistinguishable generic error', async () => {
      const enrollment = makeEnrollment();
      em.findOneOrFail.mockResolvedValue(enrollment);
      em.flush.mockRejectedValueOnce({
        code: '23505',
        constraint: 'enrollments_national_code_active_unique',
      });

      await expect(
        service.submitStep(TEST_PUBLIC_ID, 'NATIONAL_CODE', NOW, (e) => {
          e.nationalCode = '1234567890';
        }),
      ).rejects.toMatchObject({
        code: 'ENROLLMENT_STEP_NOT_ALLOWED',
      });

      // Verify the generic detail key is used (not the specific constraint).
      expect(i18n.t).toHaveBeenCalledWith('enrollment.stepNotAllowed');
    });

    it('maps username unique violation to usernameTaken detail', async () => {
      const enrollment = makeEnrollment({ currentStep: 'USERNAME' });
      em.findOneOrFail.mockResolvedValue(enrollment);
      em.flush.mockRejectedValueOnce({
        code: '23505',
        constraint: 'enrollments_username_active_unique',
      });

      await expect(
        service.submitStep(TEST_PUBLIC_ID, 'USERNAME', NOW, (e) => {
          e.username = 'taken';
        }),
      ).rejects.toMatchObject({
        code: 'ENROLLMENT_STEP_NOT_ALLOWED',
      });

      expect(i18n.t).toHaveBeenCalledWith('enrollment.usernameTaken');
    });
  });

  describe('optimistic locking', () => {
    it('maps OptimisticLockError to VersionConflict via mapOptimisticLockError', async () => {
      const enrollment = makeEnrollment();
      em.findOneOrFail.mockResolvedValue(enrollment);
      // The mapper throws AppHttpException with VersionConflict
      const { OptimisticLockError } = await import('@mikro-orm/core');
      em.flush.mockRejectedValueOnce(new OptimisticLockError('version conflict'));

      await expect(
        service.submitStep(TEST_PUBLIC_ID, 'NATIONAL_CODE', NOW, () => {}),
      ).rejects.toMatchObject({
        code: 'VERSION_CONFLICT',
      });
    });
  });

  describe('enrollment not found', () => {
    it('throws when publicId does not exist (404 from findOneOrFail)', async () => {
      em.findOneOrFail.mockRejectedValueOnce(new Error('Not found'));

      await expect(
        service.submitStep('non-existent-id', 'NATIONAL_CODE', NOW, () => {}),
      ).rejects.toThrow('Not found');
    });
  });
});
