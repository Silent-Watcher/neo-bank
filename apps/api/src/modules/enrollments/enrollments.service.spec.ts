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
    set: vi
      .fn<(key: string, value: string, options?: { ttlSeconds?: number }) => Promise<void>>()
      .mockResolvedValue(undefined),
    deleteIfEquals: vi
      .fn<(key: string, value: string) => Promise<boolean>>()
      .mockResolvedValue(false),
  };
  let service: EnrollmentsService;

  beforeEach(async () => {
    randomIntMock.mockReset();
    redisService.set.mockReset();
    redisService.set.mockResolvedValue(undefined);
    redisService.deleteIfEquals.mockReset();
    redisService.deleteIfEquals.mockResolvedValue(false);

    const module = await Test.createTestingModule({
      providers: [EnrollmentsService, { provide: RedisService, useValue: redisService }],
    }).compile();

    service = module.get(EnrollmentsService);
  });

  it('stores the generated OTP in Redis under the naming-convention key with an exact 120-second TTL', async () => {
    // Arrange
    randomIntMock.mockReturnValue(483_921);

    // Act
    await service.requestChallenge('09123456789');

    // Assert
    expect(redisService.set).toHaveBeenCalledTimes(1);
    const [key, otp, options] = redisService.set.mock.calls[0];
    expect(key).toBe('neo-bank:enrollments:challenge:otp:09123456789');
    expect(otp).toBe('483921');
    expect(options).toEqual({ ttlSeconds: CHALLENGE_OTP_TTL_SECONDS });
    expect(options?.ttlSeconds).toBe(120);
  });

  it('returns only the phone number and never the OTP value', async () => {
    // Arrange
    randomIntMock.mockReturnValue(483_921);

    // Act
    const result = await service.requestChallenge('09123456789');

    // Assert
    expect(result).toEqual({ phoneNumber: '09123456789' });
    expect(Object.keys(result)).toEqual(['phoneNumber']);
  });

  it('generates the OTP as a string of exactly six digits across the full range', async () => {
    // Arrange & Act
    randomIntMock.mockReturnValue(100_000);
    const lower = redisService.set.mock.calls.length;
    await service.requestChallenge('09123456789');
    const lowerOtp = redisService.set.mock.calls[lower][1];

    randomIntMock.mockReturnValue(999_999);
    const upper = redisService.set.mock.calls.length;
    await service.requestChallenge('09123456789');
    const upperOtp = redisService.set.mock.calls[upper][1];

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

  it('propagates Redis storage failures to the caller', async () => {
    // Arrange
    randomIntMock.mockReturnValue(483_921);
    redisService.set.mockRejectedValue(new Error('connection lost'));

    // Act & Assert
    await expect(service.requestChallenge('09123456789')).rejects.toThrow('connection lost');
  });

  describe('verifyChallenge', () => {
    it('consumes the OTP under the naming-convention key and returns the phone number on success', async () => {
      // Arrange
      redisService.deleteIfEquals.mockResolvedValue(true);

      // Act
      const result = await service.verifyChallenge('09123456789', '048391');

      // Assert
      expect(redisService.deleteIfEquals).toHaveBeenCalledWith(
        'neo-bank:enrollments:challenge:otp:09123456789',
        '048391',
      );
      expect(result).toEqual({ phoneNumber: '09123456789' });
      expect(Object.keys(result)).toEqual(['phoneNumber']);
    });

    it('rejects every failure condition with the same generic error', async () => {
      // Arrange — false covers missing, expired, and incorrect OTPs alike.
      redisService.deleteIfEquals.mockResolvedValue(false);

      // Act & Assert — one error code for all of them (the identical detail
      // text is asserted in the e2e suite; the HTTP status is part of the
      // filter contract covered there too).
      await expect(service.verifyChallenge('09123456789', '999999')).rejects.toThrow(
        AppHttpException,
      );
      await expect(service.verifyChallenge('09123456789', '999999')).rejects.toMatchObject({
        code: ErrorCode.OtpVerificationFailed,
      });
    });

    it('propagates Redis failures instead of converting them into verification failures', async () => {
      // Arrange
      redisService.deleteIfEquals.mockRejectedValue(new Error('connection lost'));

      // Act & Assert — a plain Error, not the verification failure, so the
      // global filter serves its generic 500 (asserted in e2e).
      await expect(service.verifyChallenge('09123456789', '048391')).rejects.toThrow(
        'connection lost',
      );
    });
  });
});
