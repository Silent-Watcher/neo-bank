import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { TestingModuleBuilder } from '@nestjs/testing';

import { RedisService } from '#src/shared/redis/redis.service.js';
import { createTestApp } from './create-test-app.js';

describe('EnrollmentsController (e2e)', () => {
  // Redis is overridden so the suite verifies the exact key, TTL, and stored
  // value without requiring a running Redis server.

  it('validates the phone number, stores a six-digit OTP in Redis, and returns only the phone number', async () => {
    // Arrange
    const set = vi
      .fn<(key: string, value: string, options?: { ttlSeconds?: number }) => Promise<void>>()
      .mockResolvedValue(undefined);
    const app = await createTestApp(undefined, {
      configureModule: (builder) => builder.overrideProvider(RedisService).useValue({ set }),
    });

    // Act
    const response = await request(app.getHttpServer())
      .post('/api/v1/enrollments/challenge')
      .send({ phoneNumber: '09123456789' });

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.data).toEqual({ phoneNumber: '09123456789' });
    expect(set).toHaveBeenCalledTimes(1);
    const [key, otp, options] = set.mock.calls[0];
    expect(key).toBe('neo-bank:enrollments:challenge:otp:09123456789');
    expect(otp).toMatch(/^[1-9]\d{5}$/);
    expect(options).toEqual({ ttlSeconds: 120 });
    await app.close();
  });

  it('stores the OTP under the normalized phone number for a +98 country code', async () => {
    // Arrange
    const set = vi
      .fn<(key: string, value: string, options?: { ttlSeconds?: number }) => Promise<void>>()
      .mockResolvedValue(undefined);
    const app = await createTestApp(undefined, {
      configureModule: (builder) => builder.overrideProvider(RedisService).useValue({ set }),
    });

    // Act
    const response = await request(app.getHttpServer())
      .post('/api/v1/enrollments/challenge')
      .send({ phoneNumber: '+989123456789' });

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.data).toEqual({ phoneNumber: '09123456789' });
    expect(set.mock.calls[0][0]).toBe('neo-bank:enrollments:challenge:otp:09123456789');
    await app.close();
  });

  it('rejects invalid phone numbers with Problem Details validation errors', async () => {
    // Arrange
    const app = await createTestApp(undefined, {
      configureModule: (builder) =>
        builder
          .overrideProvider(RedisService)
          .useValue({ set: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) }),
    });
    const invalidPhoneNumbers = ['02112345678', '0912 345 678', '0912345678', ''];

    // Act + Assert
    for (const phoneNumber of invalidPhoneNumbers) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/enrollments/challenge')
        .send({ phoneNumber });

      expect(response.status).toBe(400);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.body.code).toBe('BAD_REQUEST');
      expect(response.body.detail).toContain('phoneNumber: ');
    }
    await app.close();
  });

  it('serves an application-error Problem Details response when OTP storage fails', async () => {
    // Arrange
    const app = await createTestApp(undefined, {
      configureModule: (builder) =>
        builder.overrideProvider(RedisService).useValue({
          set: vi.fn<() => Promise<void>>().mockRejectedValue(new Error('connection lost')),
        }),
    });

    // Act
    const response = await request(app.getHttpServer())
      .post('/api/v1/enrollments/challenge')
      .send({ phoneNumber: '09123456789' });

    // Assert
    expect(response.status).toBe(500);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body.requestId).toBeTypeOf('string');
    await app.close();
  });

  describe('POST /enrollments/verify', () => {
    function overrideVerify(consumed: boolean) {
      const deleteIfEquals = vi
        .fn<(key: string, value: string) => Promise<boolean>>()
        .mockResolvedValue(consumed);

      return {
        deleteIfEquals,
        configureModule: (builder: TestingModuleBuilder) =>
          builder.overrideProvider(RedisService).useValue({ deleteIfEquals }),
      };
    }

    it('verifies a correct OTP and returns only the phone number', async () => {
      // Arrange
      const { configureModule, deleteIfEquals } = overrideVerify(true);
      const app = await createTestApp(undefined, { configureModule });

      // Act
      const response = await request(app.getHttpServer())
        .post('/api/v1/enrollments/verify')
        .send({ phoneNumber: '09123456789', otp: '048391' });

      // Assert
      expect(response.status).toBe(201);
      expect(response.body.data).toEqual({ phoneNumber: '09123456789' });
      expect(JSON.stringify(response.body)).not.toContain('048391');
      expect(deleteIfEquals).toHaveBeenCalledWith(
        'neo-bank:enrollments:challenge:otp:09123456789',
        '048391',
      );
      await app.close();
    });

    it('normalizes the phone number before the Redis lookup', async () => {
      // Arrange
      const { configureModule, deleteIfEquals } = overrideVerify(true);
      const app = await createTestApp(undefined, { configureModule });

      // Act
      const response = await request(app.getHttpServer())
        .post('/api/v1/enrollments/verify')
        .send({ phoneNumber: '+989123456789', otp: '000001' });

      // Assert
      expect(response.status).toBe(201);
      expect(response.body.data).toEqual({ phoneNumber: '09123456789' });
      expect(deleteIfEquals).toHaveBeenCalledWith(
        'neo-bank:enrollments:challenge:otp:09123456789',
        '000001',
      );
      await app.close();
    });

    it('returns the identical generic error for an incorrect and a missing or expired OTP', async () => {
      // Arrange — the Redis double cannot distinguish the two conditions;
      // both surface as the same consumed=false result, exactly as with a
      // real server, and must produce identical error responses.
      const incorrectApp = await createTestApp(undefined, {
        configureModule: overrideVerify(false).configureModule,
      });
      const missingApp = await createTestApp(undefined, {
        configureModule: overrideVerify(false).configureModule,
      });

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
      await incorrectApp.close();
      await missingApp.close();
    });

    it('rejects an invalid phone number or OTP format before any Redis access', async () => {
      // Arrange
      const { configureModule, deleteIfEquals } = overrideVerify(true);
      const app = await createTestApp(undefined, { configureModule });
      const invalidBodies = [
        { phone: '02112345678', otp: '048391' },
        { phone: '09123456789', otp: '48391' },
        { phone: '09123456789', otp: '48392a' },
        { phone: '09123456789', otp: 483_921 },
        { otp: '048391' },
        { phone: '09123456789' },
      ];

      // Act + Assert
      for (const body of invalidBodies) {
        const response = await request(app.getHttpServer())
          .post('/api/v1/enrollments/verify')
          .send(body);

        expect(response.status).toBe(400);
        expect(response.headers['content-type']).toContain('application/problem+json');
        expect(response.body.code).toBe('BAD_REQUEST');
      }
      expect(deleteIfEquals).not.toHaveBeenCalled();
      await app.close();
    });

    it('serves a generic error without internal details when Redis fails', async () => {
      // Arrange
      const app = await createTestApp(undefined, {
        configureModule: (builder) =>
          builder.overrideProvider(RedisService).useValue({
            deleteIfEquals: vi
              .fn<() => Promise<boolean>>()
              .mockRejectedValue(new Error('connection lost')),
          }),
      });

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
      await app.close();
    });
  });
});
