import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { createTestApp } from './create-test-app.js';

describe('Health (e2e)', () => {
  it('returns 200 when the application is healthy', async () => {
    // Arrange
    const app = await createTestApp();

    // Act
    const response = await request(app.getHttpServer()).get('/health');

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    await app.close();
  });

  it('is not served under the global prefix and version segment', async () => {
    // Arrange
    const app = await createTestApp();

    // Act
    const response = await request(app.getHttpServer()).get('/api/v1/health');

    // Assert
    expect(response.status).toBe(404);
    await app.close();
  });
});
