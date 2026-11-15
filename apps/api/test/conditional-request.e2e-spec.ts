import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { ContractController } from './contract.controller.js';
import { createE2eTestApp } from './create-test-app.js';

// Conditional-request support (ADR-032 / DEFERRED.md): weak entity tags over
// the application payload, If-None-Match revalidation answered with 304 for
// GET/HEAD — the behavior Fastify provided and the migration accepted losing
// until now. The validator is weak by design: the wire body carries
// per-response metadata (envelope timestamp/request ID), so the tag
// validates payload equivalence, not byte identity.
describe('Conditional requests (e2e)', () => {
  it('serves a weak ETag on enveloped JSON responses', async () => {
    // Arrange
    const app = await createE2eTestApp(undefined, { controllers: [ContractController] });

    // Act
    const response = await request(app.getHttpServer()).get('/api/v1/echo');

    // Assert
    expect(response.status).toBe(200);
    expect(response.headers.etag).toMatch(/^W\/"[0-9a-f]{64}"$/);
    await app.close();
  });

  it('answers a matching If-None-Match with 304 and no body', async () => {
    // Arrange
    const app = await createE2eTestApp(undefined, { controllers: [ContractController] });
    const etag = (await request(app.getHttpServer()).get('/api/v1/echo')).headers.etag as string;

    // Act
    const response = await request(app.getHttpServer())
      .get('/api/v1/echo')
      .set('If-None-Match', etag);

    // Assert — bodyless 304: no content type describing a body, no payload.
    expect(response.status).toBe(304);
    expect(response.headers['content-type']).toBeUndefined();
    expect(response.text).toBe('');
    expect(response.headers.etag).toBe(etag);
    await app.close();
  });

  it('matches a strong-quoted If-None-Match candidate under weak comparison', async () => {
    // Arrange
    const app = await createE2eTestApp(undefined, { controllers: [ContractController] });
    const weakEtag = (await request(app.getHttpServer()).get('/api/v1/echo')).headers
      .etag as string;

    // Act — RFC 9110 §13.1.2: If-None-Match compares weakly, so a client
    // stripping the W/ prefix still revalidates.
    const response = await request(app.getHttpServer())
      .get('/api/v1/echo')
      .set('If-None-Match', weakEtag.replace(/^W\//, ''));

    // Assert
    expect(response.status).toBe(304);
    await app.close();
  });

  it('answers `*` with 304 and a stale entity tag with the full response', async () => {
    // Arrange
    const app = await createE2eTestApp(undefined, { controllers: [ContractController] });
    await request(app.getHttpServer()).get('/api/v1/echo');

    // Act & Assert
    const anyMatch = await request(app.getHttpServer())
      .get('/api/v1/echo')
      .set('If-None-Match', '*');
    expect(anyMatch.status).toBe(304);

    const stale = await request(app.getHttpServer())
      .get('/api/v1/echo')
      .set('If-None-Match', 'W/"0000000000000000000000000000000000000000000000000000000000000000"');
    expect(stale.status).toBe(200);
    expect(stale.body.data).toBeDefined();
    await app.close();
  });

  it('revalidates HEAD with the same validator as GET', async () => {
    // Arrange
    const app = await createE2eTestApp(undefined, { controllers: [ContractController] });
    const get = await request(app.getHttpServer()).get('/api/v1/echo');
    const etag = get.headers.etag as string;

    // Act
    const head = await request(app.getHttpServer()).head('/api/v1/echo');

    // Assert — HEAD hashes the same handler payload, so the validator matches
    // the GET representation's tag (RFC 9110 §9.3.2: HEAD headers mirror GET).
    expect(head.headers.etag).toBe(etag);

    const revalidated = await request(app.getHttpServer())
      .head('/api/v1/echo')
      .set('If-None-Match', etag);
    expect(revalidated.status).toBe(304);
    // HEAD responses carry no body by definition (superagent exposes no text).
    await app.close();
  });

  it('keeps serving POST responses with their ETag and never revalidates them', async () => {
    // Arrange
    const app = await createE2eTestApp(undefined, { controllers: [ContractController] });
    const first = await request(app.getHttpServer()).post('/api/v1/things');
    const etag = first.headers.etag as string;
    expect(first.status).toBe(201);
    expect(etag).toMatch(/^W\/"[0-9a-f]{64}"$/);

    // Act
    const response = await request(app.getHttpServer())
      .post('/api/v1/things')
      .set('If-None-Match', etag);

    // Assert — conditional revalidation applies to GET and HEAD only.
    expect(response.status).toBe(201);
    expect(response.body.data).toEqual({ created: true });
    await app.close();
  });

  it('tags Problem Details error responses with an entity tag', async () => {
    // Error responses carry an ETag like every other JSON body. They can
    // never revalidate to 304 — the body embeds a fresh timestamp and request
    // ID per response (matching the Fastify-era behavior, where these ETags
    // also existed but never matched) — so only the tagging is asserted.
    // Arrange
    const app = await createE2eTestApp(undefined, { controllers: [ContractController] });

    // Act
    const notFound = await request(app.getHttpServer()).get('/api/v1/definitely-not-a-route');

    // Assert
    expect(notFound.status).toBe(404);
    expect(notFound.headers['content-type']).toContain('application/problem+json');
    expect(notFound.headers.etag).toMatch(/^W\/"[0-9a-f]{64}"$/);
    await app.close();
  });

  it('does not tag responses without a JSON body or SSE streams', async () => {
    // Arrange
    const app = await createE2eTestApp(undefined, { controllers: [ContractController] });

    // Act & Assert — streams, text bodies, and 304s carry no entity tag.
    const file = await request(app.getHttpServer()).get('/api/v1/file');
    expect(file.headers.etag).toBeUndefined();

    const text = await request(app.getHttpServer()).get('/api/v1/text');
    expect(text.headers.etag).toBeUndefined();

    const sse = await request(app.getHttpServer()).get('/api/v1/events');
    expect(sse.headers['content-type']).toContain('text/event-stream');
    expect(sse.headers.etag).toBeUndefined();

    await app.close();
  });
});
