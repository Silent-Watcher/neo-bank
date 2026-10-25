import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { createTestApp } from './create-test-app.js';

describe('AppController (e2e)', () => {
  it('responds with the starter greeting at /api/v1', async () => {
    // Arrange
    const app = await createTestApp();

    // Act
    const response = await request(app.getHttpServer()).get('/api/v1');

    // Assert
    expect(response.status).toBe(200);
    expect(response.text).toBe('Hello World!');
    await app.close();
  });

  it('does not serve the greeting without the global prefix and version segment', async () => {
    // Arrange
    const app = await createTestApp();

    // Act
    const response = await request(app.getHttpServer()).get('/');

    // Assert
    expect(response.status).toBe(404);
    await app.close();
  });

  it('returns 404 for an undefined route under /api/v1', async () => {
    // Arrange
    const app = await createTestApp();

    // Act
    const response = await request(app.getHttpServer()).get('/api/v1/definitely-not-a-route');

    // Assert
    expect(response.status).toBe(404);
    await app.close();
  });
});
