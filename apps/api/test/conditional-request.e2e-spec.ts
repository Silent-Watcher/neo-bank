import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { ContractController } from './contract.controller.js';
import { createE2eTestApp } from './create-test-app.js';

// Conditional-request support (ADR-032 / ADR-038): weak entity tags over the
// application payload and the request's resolved locale, If-None-Match
// revalidation answered with 304 for GET/HEAD on successful (2xx)
// representations — the behavior Fastify provided and the migration accepted
// losing until now. The validator is weak by design: the wire body carries
// per-response metadata (envelope timestamp/request ID), so the tag
// validates payload equivalence, not byte identity. The locale composes into
// the hash: the localized en/fa envelope variants are distinct
// representations and never share a validator.
describe('Conditional requests (e2e)', () => {
  it('serves a weak ETag on enveloped JSON responses', async () => {
    // Arrange
    const app = await createE2eTestApp(undefined, { controllers: [ContractController] });

    // Act
    const response = await request(app.getHttpServer()).get('/api/v1/echo');

    // Assert — revalidation semantics are explicit: private caches store but
    // must revalidate before every reuse (Wave 25/26 SEC-04).
    expect(response.status).toBe(200);
    expect(response.headers.etag).toMatch(/^W\/"[0-9a-f]{64}"$/);
    expect(response.headers['cache-control']).toBe('private, no-cache');
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

    // Assert — bodyless 304: no content type describing a body, no payload;
    // the cache directives are echoed per RFC 9110 §15.4.5.
    expect(response.status).toBe(304);
    expect(response.headers['content-type']).toBeUndefined();
    expect(response.text).toBe('');
    expect(response.headers.etag).toBe(etag);
    expect(response.headers['cache-control']).toBe('private, no-cache');
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

  it('tags primitive payloads with their own entity tag', async () => {
    // Arrange
    const app = await createE2eTestApp(undefined, { controllers: [ContractController] });

    // Act
    const response = await request(app.getHttpServer()).get('/api/v1/primitive');

    // Assert — the envelope wraps the string payload, and the tag validates it.
    expect(response.status).toBe(200);
    expect(response.body.data).toBe('plain-payload');
    expect(response.headers.etag).toMatch(/^W\/"[0-9a-f]{64}"$/);
    await app.close();
  });

  it('emits locale-dependent entity tags and revalidates per locale', async () => {
    // Arrange — the envelope message is localized, so the en/fa variants are
    // distinct representations and must not share a validator (ADR-038 §1).
    const app = await createE2eTestApp(undefined, { controllers: [ContractController] });

    // Act
    const en = await request(app.getHttpServer()).get('/api/v1/echo');
    const fa = await request(app.getHttpServer()).get('/api/v1/echo').set('Accept-Language', 'fa');
    const enEtag = en.headers.etag as string;
    const faEtag = fa.headers.etag as string;

    // Assert — different locales, different tags; each locale revalidates
    // with its own tag and not with the other locale's.
    expect(faEtag).toMatch(/^W\/"[0-9a-f]{64}"$/);
    expect(faEtag).not.toBe(enEtag);

    const faRevalidated = await request(app.getHttpServer())
      .get('/api/v1/echo')
      .set('Accept-Language', 'fa')
      .set('If-None-Match', faEtag);
    expect(faRevalidated.status).toBe(304);

    const crossLocale = await request(app.getHttpServer())
      .get('/api/v1/echo')
      .set('Accept-Language', 'fa')
      .set('If-None-Match', enEtag);
    expect(crossLocale.status).toBe(200);
    await app.close();
  });

  it('never revalidates a non-2xx response to 304', async () => {
    // Arrange — a route answering with an error status has no selected
    // representation to validate (ADR-038 §2).
    const app = await createE2eTestApp(undefined, { controllers: [ContractController] });
    const first = await request(app.getHttpServer()).get('/api/v1/custom-error-status');
    const etag = first.headers.etag as string;

    // Act
    const response = await request(app.getHttpServer())
      .get('/api/v1/custom-error-status')
      .set('If-None-Match', etag);

    // Assert — the full error-status response is served again.
    expect(first.status).toBe(400);
    expect(etag).toMatch(/^W\/"[0-9a-f]{64}"$/);
    expect(response.status).toBe(400);
    expect(response.body.data).toEqual({ failed: true });
    await app.close();
  });

  it('keeps redirect semantics when conditional headers are present', async () => {
    // Arrange — a redirect response has no tagged representation; the
    // adapter's redirect status always wins over conditional processing
    // (ADR-038 §2).
    const app = await createE2eTestApp(undefined, { controllers: [ContractController] });

    // Act
    const initial = await request(app.getHttpServer()).get('/api/v1/redirect');
    const revalidated = await request(app.getHttpServer())
      .get('/api/v1/redirect')
      .set('If-None-Match', '*');

    // Assert
    expect(initial.status).toBe(302);
    expect(initial.headers.location).toBe('/echo');
    expect(initial.headers.etag).toBeUndefined();
    expect(revalidated.status).toBe(302);
    expect(revalidated.headers.location).toBe('/echo');
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
