import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { createTestApp } from './create-test-app.js';

describe('EnrollmentsController (e2e)', () => {
  it('returns the phone number and a six-digit OTP for a valid Iranian mobile number', async () => {
    // Arrange
    const app = await createTestApp();

    // Act
    const response = await request(app.getHttpServer())
      .post('/api/v1/enrollments/otp')
      .send({ phoneNumber: '09123456789' });

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.data.phoneNumber).toBe('09123456789');
    expect(response.body.data.otp).toBeTypeOf('string');
    expect(response.body.data.otp).toMatch(/^[1-9]\d{5}$/);
    await app.close();
  });

  it('normalizes a +98 country code before returning the phone number', async () => {
    // Arrange
    const app = await createTestApp();

    // Act
    const response = await request(app.getHttpServer())
      .post('/api/v1/enrollments/otp')
      .send({ phoneNumber: '+989123456789' });

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.data.phoneNumber).toBe('09123456789');
    expect(response.body.data.otp).toMatch(/^[1-9]\d{5}$/);
    await app.close();
  });

  it('rejects invalid phone numbers with Problem Details validation errors', async () => {
    // Arrange
    const app = await createTestApp();
    const invalidPhoneNumbers = ['02112345678', '0912 345 678', '0912345678', ''];

    // Act + Assert
    for (const phoneNumber of invalidPhoneNumbers) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/enrollments/otp')
        .send({ phoneNumber });

      expect(response.status).toBe(400);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.body.code).toBe('BAD_REQUEST');
      expect(response.body.detail).toContain('phoneNumber: ');
    }
    await app.close();
  });
});
