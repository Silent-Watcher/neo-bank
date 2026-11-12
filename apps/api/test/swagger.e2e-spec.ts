import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { setupSwagger, SWAGGER_DOCS_PATH } from '#src/shared/swagger/swagger.setup.js';
import { createE2eTestApp } from './create-test-app.js';

// e2e runs with APP_ENV=test, where bootstrap registers no Swagger routes:
// that is the environment-isolation behavior. The development behavior is
// exercised by calling the same setupSwagger function the bootstrap calls
// behind the development gate, keeping the suite free of artificial
// controllers and external state.
describe('Swagger (e2e)', () => {
  it('registers no Swagger routes outside development', async () => {
    // Arrange
    const app = await createE2eTestApp();

    // Act
    const ui = await request(app.getHttpServer()).get(`/${SWAGGER_DOCS_PATH}`);
    const json = await request(app.getHttpServer()).get(`/${SWAGGER_DOCS_PATH}/json`);

    // Assert
    expect(ui.statusCode).toBe(404);
    expect(json.statusCode).toBe(404);
    await app.close();
  });

  it('serves the UI and a valid OpenAPI document in development', async () => {
    // Arrange
    const app = await createE2eTestApp((devApp) => setupSwagger(devApp));

    // Act
    const ui = await request(app.getHttpServer()).get(`/${SWAGGER_DOCS_PATH}`);
    const json = await request(app.getHttpServer()).get(`/${SWAGGER_DOCS_PATH}/json`);

    // Assert
    expect(ui.statusCode).toBe(200);
    expect(ui.headers['content-type']).toContain('text/html');
    expect(json.statusCode).toBe(200);
    expect(json.body.openapi).toMatch(/^3\.0\./);
    expect(json.body.info.title).toBe('Neo Bank API');
    expect(json.body.info.version).toBe('1');
    await app.close();
  });

  it('documents the actual routes without duplicating prefixes', async () => {
    // Arrange
    const app = await createE2eTestApp((devApp) => setupSwagger(devApp));

    // Act
    const json = await request(app.getHttpServer()).get(`/${SWAGGER_DOCS_PATH}/json`);

    // Assert
    expect(Object.keys(json.body.paths).sort()).toEqual([
      '/api/v1',
      '/api/v1/enrollments/challenge',
      '/api/v1/enrollments/verify',
      '/health',
      '/problems/application-error',
    ]);
    expect(json.body.paths['/api/v1/enrollments/challenge'].post).toBeDefined();
    expect(json.body.paths['/api/v1/enrollments/verify'].post).toBeDefined();
    expect(json.body.paths['/api/v1'].get).toBeDefined();
    expect(json.body.paths['/health'].get).toBeDefined();
    expect(json.body.paths['/problems/application-error'].get).toBeDefined();
    await app.close();
  });

  it('documents the challenge endpoint contract from the Zod schema', async () => {
    // Arrange
    const app = await createE2eTestApp((devApp) => setupSwagger(devApp));

    // Act
    const json = await request(app.getHttpServer()).get(`/${SWAGGER_DOCS_PATH}/json`);
    const challenge = json.body.paths['/api/v1/enrollments/challenge'].post;

    // Assert — request schema derived from the Zod schema (required field,
    // validated phone pattern); the response documents the phone number only
    // and the OTP value appears nowhere in the document.
    const requestBody = challenge.requestBody.content['application/json'].schema;
    expect(requestBody.type).toBe('object');
    expect(requestBody.required).toContain('phoneNumber');
    expect(requestBody.properties.phoneNumber.pattern).toBe('^09\\d{9}$');

    const okSchema = challenge.responses['200'].content['application/json'].schema;
    expect(okSchema.properties.data.required).toEqual(['phoneNumber']);
    expect(JSON.stringify(challenge)).not.toContain('"otp"');

    expect(challenge.responses['400'].description).toContain('Problem Details');
    expect(challenge.responses['500'].description).toContain('Redis');
    const badRequestSchema =
      challenge.responses['400'].content[Object.keys(challenge.responses['400'].content)[0]].schema;
    expect(badRequestSchema.properties.code).toBeDefined();
    expect(badRequestSchema.properties.requestId).toBeDefined();
    await app.close();
  });

  it('documents the health probe with degraded-mode semantics', async () => {
    // Arrange
    const app = await createE2eTestApp((devApp) => setupSwagger(devApp));

    // Act
    const json = await request(app.getHttpServer()).get(`/${SWAGGER_DOCS_PATH}/json`);
    const health = json.body.paths['/health'].get;

    // Assert
    const payload = health.responses['200'].content['application/json'].schema;
    const dataProperties = payload.properties.data.properties;
    expect(dataProperties.status.enum).toEqual(['ok', 'degraded', 'error', 'shutting_down']);
    expect(health.responses['503']).toBeDefined();
    await app.close();
  });
});
