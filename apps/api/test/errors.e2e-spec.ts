import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { ContractController } from './contract.controller.js';
import { createTestApp } from './create-test-app.js';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('Problem Details errors (e2e)', () => {
  it('normalizes built-in NestJS HTTP exceptions', async () => {
    // Arrange
    const app = await createTestApp(undefined, { controllers: [ContractController] });

    // Act
    const response = await request(app.getHttpServer()).get('/api/v1/missing');

    // Assert
    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'The requested resource was not found.',
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      apiVersion: 'v1',
      requestId: expect.stringMatching(UUID_V4_PATTERN),
      code: 'NOT_FOUND',
    });
    expect(response.body).not.toHaveProperty('message');
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
    await app.close();
  });

  it('normalizes validation message arrays into a readable detail', async () => {
    // Arrange
    const app = await createTestApp(undefined, { controllers: [ContractController] });

    // Act
    const response = await request(app.getHttpServer()).get('/api/v1/bad-array');

    // Assert
    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body.detail).toBe('name must be a string; age must be a number');
    expect(response.body.code).toBe('BAD_REQUEST');
    expect(response.body).not.toHaveProperty('message');
    await app.close();
  });

  it('normalizes AppHttpException with the family Problem Type and typed code', async () => {
    // Arrange
    const app = await createTestApp(undefined, { controllers: [ContractController] });

    // Act
    const response = await request(app.getHttpServer()).get('/api/v1/app-error');

    // Assert
    expect(response.status).toBe(409);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body.type).toBe('/problems/application-error');
    expect(response.body.title).toBe('Application Error');
    expect(response.body.detail).toBe('Something application-specific failed.');
    expect(response.body.code).toBe('APPLICATION_ERROR');
    expect(response.body.status).toBe(409);
    await app.close();
  });

  it('returns a safe generic 500 for unknown exceptions without leaking internals', async () => {
    // Arrange
    const app = await createTestApp(undefined, { controllers: [ContractController] });

    // Act
    const response = await request(app.getHttpServer()).get('/api/v1/boom');

    // Assert
    expect(response.status).toBe(500);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body.detail).toBe('An unexpected error occurred.');
    expect(response.body.code).toBe('APPLICATION_ERROR');
    expect(JSON.stringify(response.body)).not.toContain('postgres://secret');
    expect(response.body).not.toHaveProperty('stack');
    await app.close();
  });

  it('uses the correct API version and request ID on the error path', async () => {
    // Arrange
    const app = await createTestApp(undefined, { controllers: [ContractController] });

    // Act
    const response = await request(app.getHttpServer())
      .get('/health')
      .set('x-request-id', '550e8400-e29b-41d4-a716-446655440000');
    const notFound = await request(app.getHttpServer())
      .get('/api/v1/missing')
      .set('x-request-id', '550e8400-e29b-41d4-a716-446655440000');

    // Assert
    expect(notFound.body.apiVersion).toBe('v1');
    expect(notFound.body.requestId).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(response.headers['x-request-id']).toBe('550e8400-e29b-41d4-a716-446655440000');
    await app.close();
  });
});
