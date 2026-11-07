import { Controller, Get } from '@nestjs/common';
import { minutes, seconds, SkipThrottle, Throttle } from '@nestjs/throttler';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { TestRedis } from './testcontainers.js';
import type { RedisClient } from '#src/shared/redis/inject-redis.decorator.js';
import { REDIS_CLIENT } from '#src/shared/redis/redis.constants.js';
import { REDIS_CONFIG } from '#config/redis.config.js';
import type { RedisConfig } from '#config/redis.config.js';
import { createRedisClient } from '#src/shared/redis/redis.provider.js';
import { createTestApp } from './create-test-app.js';

// Rate-limit HTTP e2e tests against real Redis via Testcontainers.
// Policies: short 3 requests / 2 s, long 1000 requests / 1 min, TRUST_PROXY=true.
// Each test file gets its own isolated Redis instance with dynamic port mapping.

// Throwaway controllers exercising the official decorator APIs. One dedicated
// route per scenario so tests never share quota state with each other.
@Controller('throttle-test')
class ThrottleTestController {
  @Get('headers')
  headers(): string {
    return 'ok';
  }

  @Get('default')
  default(): string {
    return 'ok';
  }

  @Throttle({ short: { limit: 1, ttl: seconds(5) } })
  @Get('override')
  override(): string {
    return 'ok';
  }

  @SkipThrottle({ short: true, long: true })
  @Get('skipped')
  skipped(): string {
    return 'ok';
  }

  // A bare skip only targets the "default" throttler name; the named short
  // and long policies must stay active.
  @SkipThrottle()
  @Get('bare-skip')
  bareSkip(): string {
    return 'ok';
  }

  @SkipThrottle({ short: true })
  @Throttle({ long: { limit: 2, ttl: minutes(1) } })
  @Get('long-only')
  longOnly(): string {
    return 'ok';
  }

  @Get('isolation-a')
  isolationA(): string {
    return 'ok';
  }

  @Get('isolation-b')
  isolationB(): string {
    return 'ok';
  }

  @Get('proxy-ipv4')
  proxyIpv4(): string {
    return 'ok';
  }

  @Get('proxy-ipv6')
  proxyIpv6(): string {
    return 'ok';
  }

  @Get('proxy-mapped')
  proxyMapped(): string {
    return 'ok';
  }

  @Get('spoof')
  spoof(): string {
    return 'ok';
  }
}

@SkipThrottle({ short: true, long: true })
@Controller('throttle-skipped')
class SkippedController {
  @Get('skipped')
  skipped(): string {
    return 'ok';
  }

  // Explicit re-enabling of both named policies inside a skipped controller.
  @SkipThrottle({ short: false, long: false })
  @Get('limited')
  limited(): string {
    return 'ok';
  }
}

const API = '/api/v1/throttle-test';

let testRedis: TestRedis;
let inspectClient: RedisClient;
let testRedisConfig: RedisConfig;

function createAppWithTestRedis(
  controllers?: any[],
  options?: {
    adapterTrustProxy?: boolean;
  },
): Promise<Awaited<ReturnType<typeof createTestApp>>> {
  // Create a fresh Redis client for this app instance using the test Redis config
  // This ensures the throttler uses the test Redis instance, not the original one
  const testRedisClient = createRedisClient(testRedisConfig);

  return createTestApp(undefined, {
    controllers,
    adapterTrustProxy: options?.adapterTrustProxy,
    configureModule: (builder) =>
      builder
        .overrideProvider(REDIS_CONFIG)
        .useValue(testRedisConfig)
        .overrideProvider(REDIS_CLIENT)
        .useValue(testRedisClient),
  });
}

async function scanThrottleKeys(): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await inspectClient.scan(
      cursor,
      'MATCH',
      'neo-bank:throttler:rate-limit:*',
      'COUNT',
      100,
    );
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0');
  return keys;
}

async function cleanupKeys(): Promise<void> {
  const keys = await scanThrottleKeys();
  if (keys.length > 0) {
    await inspectClient.unlink(...keys);
  }
}

beforeAll(async () => {
  testRedis = new TestRedis();
  testRedisConfig = await testRedis.start();
  inspectClient = createRedisClient(testRedisConfig);
  await inspectClient.connect();
  await cleanupKeys();
});

afterEach(cleanupKeys);

afterAll(async () => {
  await inspectClient.quit();
  await testRedis.stop();
});

describe('Global rate limiting (e2e, real Redis via Testcontainers)', () => {
  describe('response headers', () => {
    it('sets named X-RateLimit headers for both policies on success', async () => {
      // Arrange
      const app = await createAppWithTestRedis([ThrottleTestController]);

      // Act
      const first = await request(app.getHttpServer()).get(`${API}/headers`);
      const second = await request(app.getHttpServer()).get(`${API}/headers`);

      // Assert
      expect(first.status).toBe(200);
      expect(first.headers['x-ratelimit-limit-short']).toBe('3');
      expect(first.headers['x-ratelimit-remaining-short']).toBe('2');
      expect(first.headers['x-ratelimit-reset-short']).toBe('2');
      expect(first.headers['x-ratelimit-limit-long']).toBe('1000');
      expect(first.headers['x-ratelimit-remaining-long']).toBe('999');
      expect(second.headers['x-ratelimit-remaining-short']).toBe('1');
      expect(second.body.data).toBe('ok');
      await app.close();
    });
  });

  describe('HTTP 429 contract', () => {
    it('returns RATE_LIMITED Problem Details with Retry-After and named headers', async () => {
      // Arrange
      const app = await createAppWithTestRedis([ThrottleTestController]);
      const server = app.getHttpServer();

      // Act
      const first = await request(server).get(`${API}/default`);
      const second = await request(server).get(`${API}/default`);
      const third = await request(server).get(`${API}/default`);
      const fourth = await request(server).get(`${API}/default`);

      // Assert
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(third.status).toBe(200);
      expect(fourth.status).toBe(429);
      expect(fourth.headers['content-type']).toContain('application/problem+json');
      expect(fourth.body).toMatchObject({
        status: 429,
        title: 'Too Many Requests',
        code: 'RATE_LIMITED',
        detail: 'Too many requests. Retry later.',
      });
      expect(fourth.headers['retry-after']).toBe('2');
      expect(fourth.headers['retry-after-short']).toBe('2');
      expect(fourth.headers['x-ratelimit-limit-short']).toBe('3');
      expect(fourth.headers['x-ratelimit-remaining-short']).toBe('0');
      expect(Number(fourth.headers['x-ratelimit-reset-short'])).toBeGreaterThan(0);
      // The global exception filter preserves the guard's headers and the
      // request ID contract.
      expect(fourth.headers['x-request-id']).toBeDefined();
      expect(fourth.body.requestId).toBe(fourth.headers['x-request-id']);
      await app.close();
    });

    it('keeps rejecting requests during the block without extending it', async () => {
      // Arrange
      const app = await createAppWithTestRedis([ThrottleTestController]);
      const server = app.getHttpServer();

      // Act
      for (let index = 0; index < 4; index += 1) {
        await request(server).get(`${API}/default`);
      }
      const duringBlock = await request(server).get(`${API}/default`);
      await new Promise((resolve) => setTimeout(resolve, 2300));
      const afterBlock = await request(server).get(`${API}/default`);

      // Assert: the block expired after the advertised Retry-After and the
      // client was not re-blocked by a stale counter.
      expect(duringBlock.status).toBe(429);
      expect(duringBlock.headers['retry-after']).toBe('2');
      expect(afterBlock.status).toBe(200);
      expect(afterBlock.headers['x-ratelimit-remaining-short']).toBe('2');
      await app.close();
    });
  });

  describe('decorators', () => {
    it('supports method-level overrides of a single named policy', async () => {
      // Arrange
      const app = await createAppWithTestRedis([ThrottleTestController]);
      const server = app.getHttpServer();

      // Act
      const first = await request(server).get(`${API}/override`);
      const second = await request(server).get(`${API}/override`);

      // Assert: short overridden to 1, long untouched at its global limit.
      expect(first.status).toBe(200);
      expect(first.headers['x-ratelimit-limit-short']).toBe('1');
      expect(first.headers['x-ratelimit-limit-long']).toBe('1000');
      expect(second.status).toBe(429);
      await app.close();
    });

    it('enforces the long policy independently when short is skipped', async () => {
      // Arrange
      const app = await createAppWithTestRedis([ThrottleTestController]);
      const server = app.getHttpServer();

      // Act
      const first = await request(server).get(`${API}/long-only`);
      const second = await request(server).get(`${API}/long-only`);
      const third = await request(server).get(`${API}/long-only`);

      // Assert
      expect(first.status).toBe(200);
      expect(first.headers['x-ratelimit-limit-long']).toBe('2');
      expect(second.status).toBe(200);
      expect(third.status).toBe(429);
      expect(third.headers['retry-after']).toBe('60');
      expect(third.headers['retry-after-long']).toBe('60');
      expect(third.headers['x-ratelimit-remaining-long']).toBe('0');
      // No short headers: that policy is skipped on this route.
      expect(third.headers['retry-after-short']).toBeUndefined();
      await app.close();
    });

    it('skips both named policies on annotated endpoints and controllers', async () => {
      // Arrange
      const app = await createAppWithTestRedis([ThrottleTestController, SkippedController]);
      const server = app.getHttpServer();

      // Act
      const responses: number[] = [];
      for (let index = 0; index < 10; index += 1) {
        const response = await request(server).get(`${API}/skipped`);
        responses.push(response.status);
        await request(server).get('/api/v1/throttle-skipped/skipped');
      }

      // Assert: neither route ever hit a limit and no headers are set.
      expect(responses.every((status) => status === 200)).toBe(true);
      const probe = await request(server).get('/api/v1/throttle-skipped/skipped');
      expect(probe.headers['x-ratelimit-limit-short']).toBeUndefined();
      await app.close();
    });

    it('re-enables throttling on a method inside a skipped controller', async () => {
      // Arrange
      const app = await createAppWithTestRedis([SkippedController]);
      const server = app.getHttpServer();

      // Act
      const statuses: number[] = [];
      for (let index = 0; index < 4; index += 1) {
        const response = await request(server).get('/api/v1/throttle-skipped/limited');
        statuses.push(response.status);
      }

      // Assert: the global short policy (3) applies again on this method.
      expect(statuses).toEqual([200, 200, 200, 429]);
      await app.close();
    });

    it('keeps named policies active under a bare @SkipThrottle()', async () => {
      // Arrange
      const app = await createAppWithTestRedis([ThrottleTestController]);
      const server = app.getHttpServer();

      // Act
      const statuses: number[] = [];
      for (let index = 0; index < 4; index += 1) {
        const response = await request(server).get(`${API}/bare-skip`);
        statuses.push(response.status);
      }

      // Assert
      expect(statuses).toEqual([200, 200, 200, 429]);
      await app.close();
    });

    it('keeps the health endpoint accessible after the client is blocked', async () => {
      // Arrange
      const app = await createAppWithTestRedis([ThrottleTestController]);
      const server = app.getHttpServer();

      // Act
      for (let index = 0; index < 4; index += 1) {
        await request(server).get(`${API}/default`);
      }
      const health = await request(server).get('/health');

      // Assert: the skipped health probe keeps answering while blocked.
      expect(health.status).toBe(200);
      expect(health.headers['x-ratelimit-limit-short']).toBeUndefined();
      await app.close();
    });
  });

  describe('endpoint isolation', () => {
    it('gives different handlers independent quotas', async () => {
      // Arrange
      const app = await createAppWithTestRedis([ThrottleTestController]);
      const server = app.getHttpServer();

      // Act: exhaust isolation-a (short limit 3).
      const statuses: number[] = [];
      for (let index = 0; index < 4; index += 1) {
        const response = await request(server).get(`${API}/isolation-a`);
        statuses.push(response.status);
      }
      const other = await request(server).get(`${API}/isolation-b`);

      // Assert
      expect(statuses).toEqual([200, 200, 200, 429]);
      expect(other.status).toBe(200);
      await app.close();
    });
  });

  describe('client identity (Fastify request.ip)', () => {
    it('uses the resolved proxy IP so different clients get separate quotas', async () => {
      // Arrange: TRUST_PROXY=true, so Fastify resolves request.ip from XFF.
      const app = await createAppWithTestRedis([ThrottleTestController]);
      const server = app.getHttpServer();

      // Act: exhaust the quota for one forwarded client.
      const statuses: number[] = [];
      for (let index = 0; index < 4; index += 1) {
        const response = await request(server)
          .get(`${API}/proxy-ipv4`)
          .set('X-Forwarded-For', '198.51.100.1');
        statuses.push(response.status);
      }
      const otherClient = await request(server)
        .get(`${API}/proxy-ipv4`)
        .set('X-Forwarded-For', '198.51.100.2');

      // Assert
      expect(statuses).toEqual([200, 200, 200, 429]);
      expect(otherClient.status).toBe(200);
      await app.close();
    });

    it('groups IPv6 addresses into /64 subnets', async () => {
      // Arrange
      const app = await createAppWithTestRedis([ThrottleTestController]);
      const server = app.getHttpServer();

      // Act: exhaust via one address, then probe from the same subnet and a
      // different subnet.
      for (let index = 0; index < 4; index += 1) {
        await request(server).get(`${API}/proxy-ipv6`).set('X-Forwarded-For', '2001:db8:1::1');
      }
      const sameSubnet = await request(server)
        .get(`${API}/proxy-ipv6`)
        .set('X-Forwarded-For', '2001:db8:1::2');
      const otherSubnet = await request(server)
        .get(`${API}/proxy-ipv6`)
        .set('X-Forwarded-For', '2001:db8:2::1');

      // Assert: same /64 shares the quota (no rotation bypass); a different
      // /64 has its own.
      expect(sameSubnet.status).toBe(429);
      expect(otherSubnet.status).toBe(200);
      await app.close();
    });

    it('normalizes IPv4-mapped IPv6 addresses to IPv4', async () => {
      // Arrange
      const app = await createAppWithTestRedis([ThrottleTestController]);
      const server = app.getHttpServer();

      // Act
      for (let index = 0; index < 4; index += 1) {
        await request(server)
          .get(`${API}/proxy-mapped`)
          .set('X-Forwarded-For', '::ffff:203.0.113.9');
      }
      const plainIpv4 = await request(server)
        .get(`${API}/proxy-mapped`)
        .set('X-Forwarded-For', '203.0.113.9');

      // Assert: both spellings resolve to the same tracker.
      expect(plainIpv4.status).toBe(429);
      await app.close();
    });

    it('ignores spoofed forwarding headers when no proxy is trusted', async () => {
      // Arrange: adapter with trustProxy=false — the validated default.
      const app = await createAppWithTestRedis([ThrottleTestController], {
        adapterTrustProxy: false,
      });
      const server = app.getHttpServer();

      // Act: exhaust the socket-address quota while rotating spoofed headers.
      const statuses: number[] = [];
      for (let index = 0; index < 4; index += 1) {
        const response = await request(server)
          .get(`${API}/spoof`)
          .set('X-Forwarded-For', `198.51.100.${index + 1}`);
        statuses.push(response.status);
      }

      // Assert: every request shares the socket IP bucket; spoofed XFF
      // values never create new identities.
      expect(statuses).toEqual([200, 200, 200, 429]);
      await app.close();
    });
  });

  describe('Redis integration', () => {
    it('stores counters under the application throttle namespace', async () => {
      // Arrange
      const app = await createAppWithTestRedis([ThrottleTestController]);
      const server = app.getHttpServer();

      // Act - use /override endpoint which has its own limit (1) to avoid
      // interference from other tests sharing the global short quota.
      const first = await request(server).get(`${API}/override`);
      const second = await request(server).get(`${API}/override`);
      expect(first.status).toBe(200);
      expect(second.status).toBe(429); // 2nd request exceeds limit of 1

      const keys = await scanThrottleKeys();

      // Assert: hit and block keys are distinguishable, namespaced, and no
      // keys leak outside the throttle namespace.
      expect(keys.length).toBeGreaterThan(0);
      expect(keys.every((key) => key.startsWith('neo-bank:throttler:rate-limit:'))).toBe(true);
      expect(keys.some((key) => key.includes(':hit:'))).toBe(true);
      expect(keys.some((key) => key.includes(':block:'))).toBe(true);
      await app.close();
    });

    it('shares counters across two application instances and survives a restart', async () => {
      // Arrange: two full application instances on one Redis backend. The
      // global short policy is 3 requests / 2 s for the same tracker.
      const appA = await createAppWithTestRedis();
      const appB = await createAppWithTestRedis();

      // Act: 3 requests total split across instances reach the limit.
      await request(appA.getHttpServer()).get('/api/v1');
      await request(appA.getHttpServer()).get('/api/v1');
      await request(appB.getHttpServer()).get('/api/v1');
      const blockedOnB = await request(appB.getHttpServer()).get('/api/v1');
      await appA.close();
      await appB.close();

      // Both instances are gone; the counter lives in Redis, so a fresh
      // instance is still blocked until the window ends.
      const appC = await createAppWithTestRedis();
      const blockedAfterRestart = await request(appC.getHttpServer()).get('/api/v1');
      await appC.close();

      // Assert
      expect(blockedOnB.status).toBe(429);
      expect(blockedAfterRestart.status).toBe(429);
    });

    it('fails closed with HTTP 500 (never a fake 429) when Redis is unreachable', async () => {
      // Arrange: an unroutable Redis client — commands fail fast (no offline
      // queue, bounded command timeout).
      const unreachable = createRedisClient({
        url: 'redis://127.0.0.1:1',
        username: '',
        password: '',
        db: 0,
        tls: false,
        connectTimeoutMs: 500,
        commandTimeoutMs: 500,
        maxRetriesPerRequest: 1,
        shutdownTimeoutMs: 500,
      });
      const app = await createTestApp(undefined, {
        controllers: [ThrottleTestController],
        configureModule: (builder) => builder.overrideProvider(REDIS_CLIENT).useValue(unreachable),
      });

      // Act
      const startedAt = Date.now();
      const response = await request(app.getHttpServer()).get(`${API}/headers`);
      const elapsedMs = Date.now() - startedAt;
      await app.close();

      // Assert: infrastructure failure surfaces as the generic 500
      // application error, not as a rate-limit verdict, and it stays bounded.
      expect(response.status).toBe(500);
      expect(response.body.code).toBe('APPLICATION_ERROR');
      expect(response.body.detail).not.toMatch(/redis|econnrefused|127\.0\.0\.1/i);
      expect(elapsedMs).toBeLessThan(5000);
    });
  });
});
