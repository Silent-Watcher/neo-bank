import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
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
  },
}));

const { randomIntMock } = vi.hoisted(() => ({
  randomIntMock: vi.fn<(min: number, max: number) => number>(),
}));

vi.mock('node:crypto', () => ({ randomInt: randomIntMock }));

import { RedisService } from '#src/shared/redis/redis.service.js';
import { AppHttpException } from '#errors/app-http.exception.js';
import { ErrorCode } from '#errors/error.code.js';
import { CHALLENGE_OTP_TTL_SECONDS, EnrollmentsService } from './enrollments.service.js';

describe('EnrollmentsService', () => {
  const redisService = {
    setNxEx: vi.fn<(key: string, value: string, ttlSeconds: number) => Promise<boolean>>(),
    verifyOtpAndCountAttempts:
      vi.fn<
        (
          otpKey: string,
          attemptsKey: string,
          otp: string,
          maxAttempts: number,
          ttlSeconds: number,
        ) => Promise<boolean>
      >(),
    checkOtpRateLimit:
      vi.fn<(rateLimitKey: string, maxSends: number, windowMinutes: number) => Promise<boolean>>(),
  };
  const configService = {
    getOrThrow: vi.fn(),
  };
  let service: EnrollmentsService;

  beforeEach(async () => {
    randomIntMock.mockReset();
    redisService.setNxEx.mockReset();
    redisService.setNxEx.mockResolvedValue(true);
    redisService.checkOtpRateLimit.mockReset();
    redisService.checkOtpRateLimit.mockResolvedValue(true);
    redisService.verifyOtpAndCountAttempts.mockReset();
    redisService.verifyOtpAndCountAttempts.mockResolvedValue(false);
    configService.getOrThrow.mockReturnValue({ maxVerifyAttempts: 5 });

    const module = await Test.createTestingModule({
      providers: [
        EnrollmentsService,
        { provide: RedisService, useValue: redisService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(EnrollmentsService);
  });

  it('stores the generated OTP in Redis under the naming-convention key with an exact 120-second TTL using SET NX EX', async () => {
    // Arrange
    randomIntMock.mockReturnValue(483_921);

    // Act
    await service.requestChallenge('09123456789');

    // Assert
    expect(redisService.setNxEx).toHaveBeenCalledTimes(1);
    const [key, otp, ttl] = redisService.setNxEx.mock.calls[0];
    expect(key).toBe('neo-bank:enrollments:challenge:otp:09123456789');
    expect(otp).toBe('483921');
    expect(ttl).toBe(CHALLENGE_OTP_TTL_SECONDS);
  });

  it('returns only the phone number and never the OTP value', async () => {
    // Arrange
    randomIntMock.mockReturnValue(483_921);

    // Act
    const result = await service.requestChallenge('09123456789');

    // Assert
    expect(result).toEqual({ phoneNumber: '09123456789' });
    expect(Object.keys(result).length).toBe(1);
  });

  it('generates the OTP as a string of exactly six digits across the full range', async () => {
    // Arrange & Act
    randomIntMock.mockReturnValue(100_000);
    await service.requestChallenge('09123456789');
    const lowerOtp = redisService.setNxEx.mock.calls[0][1];

    randomIntMock.mockReturnValue(999_999);
    await service.requestChallenge('09123456789');
    const upperOtp = redisService.setNxEx.mock.calls[1][1];

    // Assert
    expect(lowerOtp).toBe('100000');
    expect(upperOtp).toBe('999999');
  });

  it('draws the OTP from the cryptographically secure randomInt over the six-digit range', async () => {
    // Arrange
    randomIntMock.mockReturnValue(123_456);

    // Act
    await service.requestChallenge('09123456789');

    // Assert
    expect(randomIntMock).toHaveBeenCalledTimes(1);
    expect(randomIntMock).toHaveBeenCalledWith(100_000, 1_000_000);
  });

  it('rejects issuance when an active OTP already exists (SET NX EX fails)', async () => {
    // Arrange
    randomIntMock.mockReturnValue(483_921);
    redisService.setNxEx.mockResolvedValue(false);

    // Act & Assert
    await expect(service.requestChallenge('09123456789')).rejects.toThrow(AppHttpException);
    await expect(service.requestChallenge('09123456789')).rejects.toMatchObject({
      code: ErrorCode.OtpVerificationFailed,
    });
  });

  it('propagates Redis storage failures to the caller', async () => {
    // Arrange
    randomIntMock.mockReturnValue(483_921);
    redisService.setNxEx.mockRejectedValue(new Error('connection lost'));

    // Act & Assert
    await expect(service.requestChallenge('09123456789')).rejects.toThrow('connection lost');
  });

  it('checks the per-phone hourly rate limit before attempting to store the OTP', async () => {
    // Arrange
    randomIntMock.mockReturnValue(483_921);

    // Act
    await service.requestChallenge('09123456789');

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
    const promise = service.requestChallenge('09123456789');

    // Assert
    await expect(promise).rejects.toThrow(AppHttpException);
    await expect(promise).rejects.toMatchObject({
      code: ErrorCode.OtpRateLimitExceeded,
    });
    // The rate limit check should be called, but setNxEx should not be called
    expect(redisService.checkOtpRateLimit).toHaveBeenCalledTimes(1);
    expect(redisService.setNxEx).not.toHaveBeenCalled();
  });

  it('propagates Redis rate limit check failures to the caller', async () => {
    // Arrange
    randomIntMock.mockReturnValue(483_921);
    redisService.checkOtpRateLimit.mockRejectedValue(new Error('connection lost'));

    // Act & Assert
    await expect(service.requestChallenge('09123456789')).rejects.toThrow('connection lost');
  });

  describe('verifyChallenge', () => {
    it('verifies correct OTP and cleans up both OTP and attempts keys', async () => {
      // Arrange
      redisService.verifyOtpAndCountAttempts.mockResolvedValue(true);

      // Act
      const result = await service.verifyChallenge('09123456789', '048391');

      // Assert
      expect(redisService.verifyOtpAndCountAttempts).toHaveBeenCalledWith(
        'neo-bank:enrollments:challenge:otp:09123456789',
        'neo-bank:enrollments:challenge:attempts:09123456789',
        '048391',
        5,
        CHALLENGE_OTP_TTL_SECONDS,
      );
      expect(result).toEqual({ phoneNumber: '09123456789' });
      expect(Object.keys(result).length).toBe(1);
    });

    it('rejects every failure condition with the same generic error', async () => {
      // Arrange — false covers missing, expired, incorrect, or exhausted attempts alike.
      redisService.verifyOtpAndCountAttempts.mockResolvedValue(false);

      // Act & Assert — one error code for all of them.
      await expect(service.verifyChallenge('09123456789', '999999')).rejects.toThrow(
        AppHttpException,
      );
      await expect(service.verifyChallenge('09123456789', '999999')).rejects.toMatchObject({
        code: ErrorCode.OtpVerificationFailed,
      });
    });

    it('propagates Redis failures instead of converting them into verification failures', async () => {
      // Arrange
      redisService.verifyOtpAndCountAttempts.mockRejectedValue(new Error('connection lost'));

      // Act & Assert — a plain Error, not the verification failure, so the
      // global filter serves its generic 500 (asserted in e2e).
      await expect(service.verifyChallenge('09123456789', '048391')).rejects.toThrow(
        'connection lost',
      );
    });

    it('uses the configured max verification attempts from environment', async () => {
      // Arrange
      configService.getOrThrow.mockReturnValue({ maxVerifyAttempts: 3 });
      redisService.verifyOtpAndCountAttempts.mockResolvedValue(true);

      // Act
      await service.verifyChallenge('09123456789', '048391');

      // Assert
      expect(configService.getOrThrow).toHaveBeenCalled();
      expect(redisService.verifyOtpAndCountAttempts).toHaveBeenCalledWith(
        'neo-bank:enrollments:challenge:otp:09123456789',
        'neo-bank:enrollments:challenge:attempts:09123456789',
        '048391',
        3,
        CHALLENGE_OTP_TTL_SECONDS,
      );
    });
  });
});
