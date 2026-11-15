import { Controller, Post, Req } from '@nestjs/common';
import type { NodeRequest } from '@nestjs/platform-node';
import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { createE2eTestApp } from './create-test-app.js';

// Platform probe: the purpose of this suite is verifying the HTTP adapter's
// own configuration behavior (ADR-032), so reading the platform request type
// here is the point of the test, not a reusable-component coupling.
@Controller()
class IpProbeController {
  @Post('__probe/ip')
  probeIp(@Req() request: NodeRequest): { ip: string | undefined } {
    return { ip: request.ip };
  }
}

describe('HTTP adapter configuration (e2e)', () => {
  it('rejects a JSON body larger than the configured BODY_LIMIT with 413', async () => {
    // Arrange: env/.env.test sets BODY_LIMIT=2097152, distinct from the
    // adapter's 100 KB default and the 1048576 development default, so an
    // oversized body proves the environment value was applied to the parser.
    const app = await createE2eTestApp(undefined, { controllers: [IpProbeController] });

    // Act
    const response = await request(app.getHttpServer())
      .post('/api/v1/__probe/ip')
      .send({ payload: 'x'.repeat(3 * 1024 * 1024) });

    // Assert
    expect(response.status).toBe(413);
    await app.close();
  });

  it('accepts a JSON body just under the configured BODY_LIMIT', async () => {
    // Arrange
    const app = await createE2eTestApp(undefined, { controllers: [IpProbeController] });

    // Act — comfortably under the 2 MiB limit, but well above the adapter's
    // 100 KB default so a misconfigured parser chain fails this test.
    const response = await request(app.getHttpServer())
      .post('/api/v1/__probe/ip')
      .send({ payload: 'x'.repeat(256 * 1024) });

    // Assert — with no X-Forwarded-For in play, req.ip is the socket address:
    // a loopback form (127.0.0.1 or the IPv4-mapped ::ffff:127.0.0.1), never
    // the attacker-settable forwarded value. The exact mapped form is
    // environment-dependent, so only the loopback family is asserted.
    expect(response.status).toBe(201);
    expect(['127.0.0.1', '::1', '::ffff:127.0.0.1']).toContain(response.body.data.ip);
    await app.close();
  });

  it('honors forwarded headers because TRUST_PROXY=true in the test environment', async () => {
    // Arrange
    const app = await createE2eTestApp(undefined, { controllers: [IpProbeController] });

    // Act
    const response = await request(app.getHttpServer())
      .post('/api/v1/__probe/ip')
      .set('X-Forwarded-For', '10.1.2.3')
      .send({ payload: 'small' });

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.data.ip).toBe('10.1.2.3');
    await app.close();
  });

  it('honors forwarded headers under an allowlist containing the direct peer', async () => {
    // The narrowed trust path (Wave 18 SEC-01): with TRUST_PROXY_PROXIES the
    // adapter trusts only the listed proxies. supertest connects from
    // loopback, so listing the loopback address makes it the trusted proxy.
    // Arrange
    const app = await createE2eTestApp(undefined, {
      controllers: [IpProbeController],
      adapterTrustProxy: ['127.0.0.1'],
    });

    // Act
    const response = await request(app.getHttpServer())
      .post('/api/v1/__probe/ip')
      .set('X-Forwarded-For', '198.51.100.7')
      .send({ payload: 'small' });

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.data.ip).toBe('198.51.100.7');
    await app.close();
  });

  it('ignores forwarded headers under an allowlist that excludes the direct peer', async () => {
    // Arrange — the allowlist trusts only 10.0.0.0/8; the direct peer is
    // loopback, so the forwarded header is untrusted and req.ip stays the
    // socket address.
    const app = await createE2eTestApp(undefined, {
      controllers: [IpProbeController],
      adapterTrustProxy: ['10.0.0.0/8'],
    });

    // Act
    const response = await request(app.getHttpServer())
      .post('/api/v1/__probe/ip')
      .set('X-Forwarded-For', '198.51.100.7')
      .send({ payload: 'small' });

    // Assert
    expect(response.status).toBe(201);
    expect(['127.0.0.1', '::1', '::ffff:127.0.0.1']).toContain(response.body.data.ip);
    await app.close();
  });
});
