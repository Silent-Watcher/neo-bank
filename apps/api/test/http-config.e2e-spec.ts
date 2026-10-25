import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { createTestApp } from './create-test-app.js';

describe('HTTP adapter configuration (e2e)', () => {
  it('passes the configured BODY_LIMIT from the environment to Fastify', async () => {
    // Arrange: env/.env.test sets BODY_LIMIT=2097152, distinct from the 1048576
    // default, so a matching limit proves the environment value was applied.
    const app = await createTestApp();

    // Act
    const initialConfig = app.getHttpAdapter().getInstance().initialConfig;

    // Assert
    expect(initialConfig.bodyLimit).toBe(2097152);
    await app.close();
  });

  it('honors forwarded headers because TRUST_PROXY=true in the test environment', async () => {
    // Arrange
    const app = await createTestApp((nestApp) => {
      nestApp
        .getHttpAdapter()
        .getInstance()
        .get('/__probe__/ip', (fastifyRequest, reply) => {
          void reply.send({ ip: fastifyRequest.ip });
        });
    });

    // Act
    const response = await request(app.getHttpServer())
      .get('/__probe__/ip')
      .set('X-Forwarded-For', '10.1.2.3');

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.ip).toBe('10.1.2.3');
    await app.close();
  });
});
