import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { ContractController } from './contract.controller.js';
import { createTestApp } from './create-test-app.js';

describe('ZodValidationPipe (e2e)', () => {
  it('validates the body and returns the coerced parsed output', async () => {
    // Arrange
    const app = await createTestApp(undefined, { controllers: [ContractController] });

    // Act
    const response = await request(app.getHttpServer())
      .post('/api/v1/validate/things')
      .send({ name: 'Ada', age: '42' });

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.data).toEqual({ name: 'Ada', age: 42 });
    await app.close();
  });

  it('rejects an invalid body with Problem Details carrying the issue messages', async () => {
    // Arrange
    const app = await createTestApp(undefined, { controllers: [ContractController] });

    // Act
    const response = await request(app.getHttpServer())
      .post('/api/v1/validate/things')
      .send({ name: '', age: 'abc' });

    // Assert
    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body.code).toBe('BAD_REQUEST');
    expect(response.body.detail).toContain('name: ');
    expect(response.body.detail).toContain('age: ');
    expect(response.body).not.toHaveProperty('message');
    await app.close();
  });

  it('validates a route parameter and coerces it to a number', async () => {
    // Arrange
    const app = await createTestApp(undefined, { controllers: [ContractController] });

    // Act
    const response = await request(app.getHttpServer()).get('/api/v1/validate/things/7');

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ id: 7 });
    await app.close();
  });

  it('rejects an invalid route parameter without a stray path prefix', async () => {
    // Arrange
    const app = await createTestApp(undefined, { controllers: [ContractController] });

    // Act
    const response = await request(app.getHttpServer()).get('/api/v1/validate/things/abc');

    // Assert
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('BAD_REQUEST');
    expect(response.body.detail).not.toMatch(/^: /);
    await app.close();
  });

  it('validates query parameters and applies schema defaults', async () => {
    // Arrange
    const app = await createTestApp(undefined, { controllers: [ContractController] });

    // Act
    const response = await request(app.getHttpServer()).get('/api/v1/validate/search');

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ limit: 10 });
    await app.close();
  });
});
