import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { RedisService } from '#redis/redis.service.js';
import { createE2eTestApp } from './create-test-app.js';

// Global rate limiting makes Redis a hard dependency for guarded routes, and
// the suite's Redis is the shared Testcontainers container started by
// test/e2e.global-setup.ts (ADR-025). The degraded path is produced by
// overriding RedisService with a failing ping: the health indicator sees the
// same rejection shape a real outage produces, without any external server
// state. The healthy state is simulated the same way, keeping the suite
// deterministic.
describe('Health with Redis (e2e)', () => {
  it('starts the application and reports degraded Redis health with HTTP 200', async () => {
    // Arrange — the ping fails exactly as it does while Redis is unreachable.
    const app = await createE2eTestApp(undefined, {
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
    const app = await createE2eTestApp(undefined, {
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

// Readiness (ADR-026): the strict Redis variant must FAIL the readiness check
// (HTTP 503, Problem Details) while the liveness endpoint above stays 200.
describe('Readiness with Redis (e2e)', () => {
  it('reports 503 Problem Details when Redis is unreachable', async () => {
    // Arrange
    const app = await createE2eTestApp(undefined, {
      configureModule: (builder) =>
        builder.overrideProvider(RedisService).useValue({
          ping: () => Promise.reject(new Error('Redis unavailable')),
        }),
    });

    // Act
    const response = await request(app.getHttpServer()).get('/health/ready');

    // Assert
    expect(response.status).toBe(503);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body.code).toBe('SERVICE_UNAVAILABLE');
    expect(response.body.title).toBe('Service Unavailable');
    await app.close();
  });

  it('reports 200 when Redis is reachable and memory protection is inactive', async () => {
    // Arrange
    const app = await createE2eTestApp(undefined, {
      configureModule: (builder) =>
        builder.overrideProvider(RedisService).useValue({
          ping: () => Promise.resolve(),
        }),
    });

    // Act
    const response = await request(app.getHttpServer()).get('/health/ready');

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('ok');
    expect(response.body.data.info.redis.status).toBe('up');
    expect(response.body.data.info.memory.status).toBe('up');
    await app.close();
  });
});
