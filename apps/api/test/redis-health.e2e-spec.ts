import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { RedisService } from '#src/shared/redis/redis.service.js';
import { createTestApp } from './create-test-app.js';

// env/.env.test points Redis at an unreachable local address, so the default
// application state exercises the real degraded path: the client is created
// and connecting in the background, but every PING fails fast (no offline
// queue) while the application stays up. The healthy state is simulated by
// overriding RedisService, keeping the suite independent of a running Redis.
describe('Health with Redis (e2e)', () => {
  it('starts the application and reports degraded Redis health with HTTP 200', async () => {
    // Arrange — no Redis server is running at the configured address.
    const app = await createTestApp();

    // Act
    const response = await request(app.getHttpServer()).get('/health');

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('degraded');
    expect(response.body.data.info.redis.status).toBe('degraded');
    await app.close();
  });

  it('reports an overall ok status when Redis is reachable', async () => {
    // Arrange
    const app = await createTestApp(undefined, {
      configureModule: (builder) =>
        builder.overrideProvider(RedisService).useValue({
          ping: () => Promise.resolve(),
        }),
    });

    // Act
    const response = await request(app.getHttpServer()).get('/health');

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('ok');
    expect(response.body.data.info.redis.status).toBe('up');
    await app.close();
  });
});
