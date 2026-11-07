import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { RedisService } from '#src/shared/redis/redis.service.js';
import { createTestApp } from './create-test-app.js';

// env/.env.test points Redis at the real compose dev server (global rate
// limiting makes Redis a hard dependency for guarded routes), so the degraded
// path is produced by overriding RedisService with a failing ping: the health
// indicator sees the same rejection shape a real outage produces. The healthy
// state is simulated the same way, keeping the suite deterministic.
describe('Health with Redis (e2e)', () => {
  it('starts the application and reports degraded Redis health with HTTP 200', async () => {
    // Arrange — the ping fails exactly as it does while Redis is unreachable.
    const app = await createTestApp(undefined, {
      configureModule: (builder) =>
        builder.overrideProvider(RedisService).useValue({
          ping: () => Promise.reject(new Error('Redis unavailable')),
        }),
    });

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
