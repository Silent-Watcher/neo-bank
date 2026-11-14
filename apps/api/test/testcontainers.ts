import { GenericContainer, Wait } from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';
import type { RedisConfig } from '#config/redis.config.js';

/**
 * Testcontainers-based Redis instance for integration and E2E tests.
 *
 * Provides a real Redis instance with dynamic port mapping, matching the
 * project's production image (`redis:8.2-alpine`). Use in test files that
 * require real Redis behavior (atomic Lua scripts, TTL, connection lifecycle).
 *
 * Unit tests must continue mocking `RedisService` and should not use this.
 */
export class TestRedis {
  private container: StartedTestContainer | null = null;
  private config: RedisConfig | null = null;

  /**
   * Starts a Redis container.
   *
   * @param options - Optional configuration overrides
   * @returns Promise resolving to connection config compatible with `createRedisClient()`
   */
  async start(options?: {
    image?: string;
    password?: string;
    username?: string;
    db?: number;
  }): Promise<RedisConfig> {
    const image = options?.image ?? 'redis:8.2-alpine';
    const password = options?.password ?? 'test-password';
    const username = options?.username ?? 'default';
    const db = options?.db ?? 0;

    // Use GenericContainer with redis image and password via env
    // (the RedisContainer module class is not used: it does not support
    // withUsername() and the scoped wrapper package is not installed)
    this.container = await new GenericContainer(image)
      .withEnvironment({ REDIS_PASSWORD: password })
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start();

    const host = this.container.getHost();
    const port = this.container.getMappedPort(6379);

    this.config = {
      url: `redis://${host}:${port}`,
      username,
      password,
      db,
      tls: false,
      connectTimeoutMs: 5000,
      commandTimeoutMs: 5000,
      maxRetriesPerRequest: 3,
      shutdownTimeoutMs: 2000,
    };

    return this.config;
  }

  /**
   * Returns the connection config for the running container.
   * Must be called after `start()`.
   */
  getConfig(): RedisConfig {
    if (!this.config) {
      throw new Error('TestRedis not started. Call start() first.');
    }
    return this.config;
  }

  /**
   * Stops and removes the container.
   * Safe to call multiple times.
   */
  async stop(): Promise<void> {
    if (this.container) {
      await this.container.stop();
      this.container = null;
      this.config = null;
    }
  }

  /**
   * Returns the container's host port mapping.
   * Only available after `start()`.
   */
  getMappedPort(): number {
    if (!this.container) {
      throw new Error('TestRedis not started. Call start() first.');
    }
    return this.container.getMappedPort(6379);
  }
}

/**
 * Convenience function to start a Redis container and get config.
 * Use in `beforeAll` with corresponding `stop()` in `afterAll`.
 */
export async function startTestRedis(options?: {
  image?: string;
  password?: string;
  username?: string;
  db?: number;
}): Promise<{ redis: TestRedis; config: RedisConfig }> {
  const redis = new TestRedis();
  const config = await redis.start(options);
  return { redis, config };
}

/**
 * Testcontainers-based PostgreSQL instance for integration and E2E tests
 * (ADR-027).
 *
 * Provides a real PostgreSQL server with dynamic port mapping, matching the
 * project's production image (`postgres:17.6-alpine`, the same pin as the
 * Compose stacks). The connection is returned as a PostgreSQL URL, the shape
 * `DATABASE_CONFIG` and the MikroORM options builder consume.
 */
export class TestPostgres {
  private container: StartedTestContainer | null = null;
  private url: string | null = null;

  /**
   * Starts a PostgreSQL container.
   *
   * @returns Promise resolving to the `postgresql://` URL of the running container
   */
  async start(options?: {
    image?: string;
    username?: string;
    password?: string;
    database?: string;
  }): Promise<string> {
    const image = options?.image ?? 'postgres:17.6-alpine';
    const username = options?.username ?? 'neo_bank';
    const password = options?.password ?? 'test-password';
    const database = options?.database ?? 'neo_bank';

    this.container = await new GenericContainer(image)
      .withEnvironment({
        POSTGRES_USER: username,
        POSTGRES_PASSWORD: password,
        POSTGRES_DB: database,
      })
      .withExposedPorts(5432)
      // The message appears twice during first-boot initialization (before
      // and after the temporary server restart); waiting for two occurrences
      // means real startup completed.
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start();

    const host = this.container.getHost();
    const port = this.container.getMappedPort(5432);

    this.url = `postgresql://${username}:${password}@${host}:${port}/${database}`;

    return this.url;
  }

  /**
   * Returns the connection URL for the running container.
   * Must be called after `start()`.
   */
  getUrl(): string {
    if (!this.url) {
      throw new Error('TestPostgres not started. Call start() first.');
    }
    return this.url;
  }

  /**
   * Stops and removes the container.
   * Safe to call multiple times.
   */
  async stop(): Promise<void> {
    if (this.container) {
      await this.container.stop();
      this.container = null;
      this.url = null;
    }
  }
}

/**
 * Convenience function to start a PostgreSQL container and get its URL.
 * Use in `beforeAll` with corresponding `stop()` in `afterAll`.
 */
export async function startTestPostgres(options?: {
  image?: string;
  username?: string;
  password?: string;
  database?: string;
}): Promise<{ postgres: TestPostgres; url: string }> {
  const postgres = new TestPostgres();
  const url = await postgres.start(options);
  return { postgres, url };
}
