import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

import { createE2eTestApp } from './create-test-app.js';
import { RedisService } from '#src/shared/redis/redis.service.js';

describe('Health (e2e)', () => {
  it('returns 200 with the health payload wrapped in the envelope', async () => {
    // Arrange
    const app = await createE2eTestApp(undefined, {
      configureModule: (builder) => {
        builder.overrideProvider(RedisService).useValue({
          ping: vi.fn().mockResolvedValue('PONG'),
        });
      },
    });
    // Act
    const response = await request(app.getHttpServer()).get('/health');

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Success');
    expect(response.body.status).toBe(200);
    expect(response.body.apiVersion).toBe('neutral');
    expect(response.body.data.status).toBe('ok');
    await app.close();
  });

  it('is not served under the global prefix and version segment', async () => {
    // Arrange
    const app = await createE2eTestApp();

    // Act
    const response = await request(app.getHttpServer()).get('/api/v1/health');

    // Assert
    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    await app.close();
  });
});
