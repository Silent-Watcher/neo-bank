import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { ContractController } from './contract.controller.js';
import { createTestApp } from './create-test-app.js';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('Response envelope (e2e)', () => {
  it('wraps an ordinary successful JSON response exactly once', async () => {
    // Arrange
    const app = await createTestApp(undefined, { controllers: [ContractController] });

    // Act
    const response = await request(app.getHttpServer()).get('/api/v1/echo');

    // Assert
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      apiVersion: 'v1',
      requestId: expect.stringMatching(UUID_V4_PATTERN),
      status: 200,
      message: 'Success',
      data: { example: true },
    });
    await app.close();
  });

  it('reflects the actual status code, including 201', async () => {
    // Arrange
    const app = await createTestApp(undefined, { controllers: [ContractController] });

    // Act
    const response = await request(app.getHttpServer()).post('/api/v1/things');

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.status).toBe(201);
    expect(response.body.message).toBe('Success');
    expect(response.body.data).toEqual({ created: true });
    await app.close();
  });

  it('keeps the request ID consistent between the envelope and the header', async () => {
    // Arrange
    const app = await createTestApp(undefined, { controllers: [ContractController] });

    // Act
    const response = await request(app.getHttpServer()).get('/api/v1/echo');

    // Assert
    expect(response.headers['x-request-id']).toMatch(UUID_V4_PATTERN);
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
    await app.close();
  });

  it('preserves the no-body behavior of 204 responses', async () => {
    // Arrange
    const app = await createTestApp(undefined, { controllers: [ContractController] });

    // Act
    const response = await request(app.getHttpServer()).get('/api/v1/no-content');

    // Assert
    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    await app.close();
  });

  it('preserves the no-body behavior of 304 responses', async () => {
    // Arrange
    const app = await createTestApp(undefined, { controllers: [ContractController] });

    // Act
    const response = await request(app.getHttpServer()).get('/api/v1/not-modified');

    // Assert
    expect(response.status).toBe(304);
    expect(response.text).toBe('');
    await app.close();
  });

  it('does not wrap HEAD responses', async () => {
    // Arrange
    const app = await createTestApp(undefined, { controllers: [ContractController] });

    // Act
    const response = await request(app.getHttpServer()).head('/api/v1/resource');

    // Assert
    expect(response.status).toBe(200);
    expect(response.text).toBe('');
    await app.close();
  });

  it('passes file downloads through unwrapped', async () => {
    // Arrange
    const app = await createTestApp(undefined, { controllers: [ContractController] });

    // Act
    const response = await request(app.getHttpServer()).get('/api/v1/file');

    // Assert
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/octet-stream');
    expect(response.text).toBe('file-content');
    await app.close();
  });

  it('passes non-JSON responses through unwrapped', async () => {
    // Arrange
    const app = await createTestApp(undefined, { controllers: [ContractController] });

    // Act
    const response = await request(app.getHttpServer()).get('/api/v1/text');

    // Assert
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.text).toBe('plain-text-body');
    await app.close();
  });

  it('does not corrupt Server-Sent Events responses', async () => {
    // Arrange
    const app = await createTestApp(undefined, { controllers: [ContractController] });

    // Act
    const response = await request(app.getHttpServer()).get('/api/v1/events');

    // Assert
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.text).toContain('data: {"hello":true}');
    expect(response.text).not.toContain('Success');
    await app.close();
  });
});
