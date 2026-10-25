import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { createTestApp } from './create-test-app.js';

// Must match CORS_ORIGIN in env/.env.test, which the e2e run loads.
const allowedOrigin = 'http://localhost:3000';

describe('CORS (e2e)', () => {
  it('grants an allowed origin access to a regular response', async () => {
    // Arrange
    const app = await createTestApp();

    // Act
    const response = await request(app.getHttpServer())
      .get('/api/v1')
      .set('Origin', allowedOrigin)
      .expect(200);

    // Assert
    expect(response.headers['access-control-allow-origin']).toBe(allowedOrigin);
    await app.close();
  });

  it('does not grant a disallowed origin access', async () => {
    // Arrange
    const app = await createTestApp();

    // Act
    const response = await request(app.getHttpServer())
      .get('/api/v1')
      .set('Origin', 'http://evil.example.com')
      .expect(200);

    // Assert: the request is processed but never granted CORS access.
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });

  it('does not treat a different port or scheme as an allowed origin', async () => {
    // Arrange
    const app = await createTestApp();

    // Act & Assert
    for (const origin of ['http://localhost:3001', 'https://localhost:3000']) {
      const response = await request(app.getHttpServer()).get('/api/v1').set('Origin', origin);

      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    }
    await app.close();
  });

  it('answers a preflight from an allowed origin with the requested method', async () => {
    // Arrange
    const app = await createTestApp();

    // Act
    const response = await request(app.getHttpServer())
      .options('/api/v1')
      .set('Origin', allowedOrigin)
      .set('Access-Control-Request-Method', 'GET')
      .expect(204);

    // Assert
    expect(response.headers['access-control-allow-origin']).toBe(allowedOrigin);
    expect(response.headers['access-control-allow-methods']).toContain('GET');
    await app.close();
  });

  it('echoes permitted request headers in the preflight response', async () => {
    // Arrange
    const app = await createTestApp();

    // Act
    const response = await request(app.getHttpServer())
      .options('/api/v1')
      .set('Origin', allowedOrigin)
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'content-type')
      .expect(204);

    // Assert
    expect(response.headers['access-control-allow-headers']).toContain('content-type');
    await app.close();
  });

  it('does not answer a preflight from a disallowed origin', async () => {
    // Arrange
    const app = await createTestApp();

    // Act
    const response = await request(app.getHttpServer())
      .options('/api/v1')
      .set('Origin', 'http://evil.example.com')
      .set('Access-Control-Request-Method', 'GET');

    // Assert
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });
});
