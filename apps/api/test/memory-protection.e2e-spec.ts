import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MEMORY_PROTECTION_CONFIG } from '#config/memory-protection.config.js';
import { createE2eTestApp } from './create-test-app.js';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

// Memory-based load shedding (ADR-026), exercised end to end with a
// configuration override instead of real memory pressure: the protection
// threshold is set to 1 MB, so the first sample taken at application
// bootstrap activates the protection state deterministically. The recovery
// threshold of 0 keeps the state active for the lifetime of the app instance
// (recovery transitions themselves are covered by the service unit specs).
//
// The liveness endpoint (GET /health) and the Problem-Type docs page are
// exempt (@SkipMemoryProtection) and must stay reachable while every
// non-exempt route receives the 503 rejection.
describe('Memory protection (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createE2eTestApp(undefined, {
      configureModule: (builder) =>
        builder.overrideProvider(MEMORY_PROTECTION_CONFIG).useValue({
          enabled: true,
          maxRssMb: 1,
          recoveryRssMb: 0,
          sampleIntervalMs: 60000,
          stableSamples: 1,
        }),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a non-exempt route with 503 Problem Details and Retry-After', async () => {
    // Act
    const response = await request(app.getHttpServer()).get('/api/v1');

    // Assert
    expect(response.status).toBe(503);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.headers['retry-after']).toBe('60');
    expect(response.body.code).toBe('SERVICE_UNAVAILABLE');
    expect(response.body.type).toBe('/problems/application-error');
    expect(response.body.title).toBe('Service Unavailable');
    expect(response.body.detail).toBe(
      'The service is temporarily under heavy load. Please retry shortly.',
    );
  });

  it('keeps the liveness endpoint reachable with HTTP 200', async () => {
    // Act
    const response = await request(app.getHttpServer()).get('/health');

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('ok');
  });

  it('fails the readiness endpoint with 503 while the protection state is active', async () => {
    // Act
    const response = await request(app.getHttpServer()).get('/health/ready');

    // Assert
    expect(response.status).toBe(503);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body.code).toBe('SERVICE_UNAVAILABLE');
    // The Problem Details 503 body is the filter's contract, not the Terminus
    // aggregate; the indicator details live in the 200 payload of a healthy
    // readiness check (covered in redis-health.e2e-spec).
    expect(response.body.title).toBe('Service Unavailable');
  });

  it('keeps the Problem-Type documentation page reachable', async () => {
    // Act
    const response = await request(app.getHttpServer()).get('/problems/application-error');

    // Assert
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
  });
});
