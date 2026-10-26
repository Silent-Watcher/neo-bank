import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { createTestApp } from './create-test-app.js';

describe('AppController (e2e)', () => {
  it('responds with the starter greeting wrapped in the envelope at /api/v1', async () => {
    // Arrange
    const app = await createTestApp();

    // Act
    const response = await request(app.getHttpServer()).get('/api/v1');

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Success');
    expect(response.body.status).toBe(200);
    expect(response.body.data).toBe('Hello World!');
    await app.close();
  });

  it('does not serve the greeting without the global prefix and version segment', async () => {
    // Arrange
    const app = await createTestApp();

    // Act
    const response = await request(app.getHttpServer()).get('/');

    // Assert
    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    await app.close();
  });

  it('returns a Problem Details 404 for an undefined route under /api/v1', async () => {
    // Arrange
    const app = await createTestApp();

    // Act
    const response = await request(app.getHttpServer()).get('/api/v1/definitely-not-a-route');

    // Assert
    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
    await app.close();
  });
});
