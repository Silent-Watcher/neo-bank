import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

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
});
