import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { ContractController } from './contract.controller.js';
import { createTestApp } from './create-test-app.js';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VALID_UUID_V4_UPPERCASE = '550E8400-E29B-41D4-A716-446655440000';
const VALID_UUID_V4_LOWERCASE = '550e8400-e29b-41d4-a716-446655440000';
const UUID_V1 = '550e8400-e29b-11d4-a716-446655440000';

describe('Request IDs (e2e)', () => {
  it('generates a valid UUIDv4 when the header is absent', async () => {
    // Arrange
    const app = await createTestApp(undefined, { controllers: [ContractController] });

    // Act
    const response = await request(app.getHttpServer()).get('/api/v1/echo');

    // Assert
    expect(response.headers['x-request-id']).toMatch(UUID_V4_PATTERN);
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
    await app.close();
  });

  it('accepts a valid inbound UUIDv4 and normalizes it to lowercase', async () => {
    // Arrange
    const app = await createTestApp(undefined, { controllers: [ContractController] });

    // Act
    const response = await request(app.getHttpServer())
      .get('/api/v1/echo')
      .set('x-request-id', VALID_UUID_V4_UPPERCASE);

    // Assert
    expect(response.headers['x-request-id']).toBe(VALID_UUID_V4_LOWERCASE);
    expect(response.body.requestId).toBe(VALID_UUID_V4_LOWERCASE);
    await app.close();
  });

  it('rejects malformed UUIDs with a standardized 400 before the handler runs', async () => {
    // Arrange
    const app = await createTestApp(undefined, { controllers: [ContractController] });

    // Act
    const response = await request(app.getHttpServer())
      .get('/api/v1/echo')
      .set('x-request-id', 'not-a-uuid');

    // Assert
    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body.code).toBe('INVALID_REQUEST_ID');
    expect(response.body.status).toBe(400);
    expect(response.body.type).toBe('/problems/application-error');
    // The invalid value is never echoed or trusted; a fresh UUIDv4 is assigned.
    expect(response.headers['x-request-id']).toMatch(UUID_V4_PATTERN);
    expect(response.headers['x-request-id']).not.toBe('not-a-uuid');
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
    await app.close();
  });

  it('rejects UUIDs of other versions', async () => {
    // Arrange
    const app = await createTestApp(undefined, { controllers: [ContractController] });

    // Act
    const response = await request(app.getHttpServer())
      .get('/api/v1/echo')
      .set('x-request-id', UUID_V1);

    // Assert
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_REQUEST_ID');
    expect(response.headers['x-request-id']).not.toBe(UUID_V1);
    await app.close();
  });

  it('rejects multiple header values that cannot be one valid UUIDv4', async () => {
    // Arrange
    const app = await createTestApp(undefined, { controllers: [ContractController] });

    // Act
    const response = await request(app.getHttpServer())
      .get('/api/v1/echo')
      .set('x-request-id', `${VALID_UUID_V4_LOWERCASE}, ${VALID_UUID_V4_LOWERCASE}`);

    // Assert
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_REQUEST_ID');
    expect(response.headers['x-request-id']).not.toBe(VALID_UUID_V4_LOWERCASE);
    await app.close();
  });

  it('carries the request ID on responses to excluded and version-neutral routes', async () => {
    // Arrange
    const app = await createTestApp();

    // Act
    const response = await request(app.getHttpServer()).get('/health');

    // Assert
    expect(response.headers['x-request-id']).toMatch(UUID_V4_PATTERN);
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
    await app.close();
  });
});
