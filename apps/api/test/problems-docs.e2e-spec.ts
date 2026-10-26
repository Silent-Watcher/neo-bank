import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { createTestApp } from './create-test-app.js';

describe('Problem Type documentation (e2e)', () => {
  it('serves the application-error Problem Type page as HTML', async () => {
    // Arrange
    const app = await createTestApp();

    // Act
    const response = await request(app.getHttpServer()).get('/problems/application-error');

    // Assert
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.text).toContain('<!doctype html>');
    expect(response.text).toContain('Application Error');
    expect(response.text).toContain('/problems/application-error');
    // The page is excluded from the JSON response envelope.
    expect(response.text).not.toContain('"message":"Success"');
    await app.close();
  });

  it('resolves at the exact URI used in Problem Details responses, without the API prefix', async () => {
    // Arrange
    const app = await createTestApp();

    // Act
    const prefixed = await request(app.getHttpServer()).get('/api/v1/problems/application-error');

    // Assert
    expect(prefixed.status).toBe(404);
    await app.close();
  });
});
