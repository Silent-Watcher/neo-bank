import { GenericContainer, Wait } from 'testcontainers';
import type { StartedNetwork, StartedTestContainer } from 'testcontainers';
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
    /** Attach the container to an explicit shared network (e.g. with Toxiproxy). */
    network?: StartedNetwork;
    /** Alias to address the container by inside the shared network. */
    networkAlias?: string;
  }): Promise<RedisConfig> {
    const image = options?.image ?? 'redis:8.2-alpine';
    const password = options?.password ?? 'test-password';
    const username = options?.username ?? 'default';
    const db = options?.db ?? 0;

    // Use GenericContainer with redis image and password via env
    // (the RedisContainer module class is not used: it does not support
    // withUsername() and the scoped wrapper package is not installed)
    let builder = new GenericContainer(image)
      .withEnvironment({ REDIS_PASSWORD: password })
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'));
    if (options?.network) {
      builder = builder
        .withNetwork(options.network)
        .withNetworkAliases(options?.networkAlias ?? 'redis');
    }

    this.container = await builder.start();

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
      // Above the command timeout — the ADR-037 invariant the env schema
      // enforces in production (per-command failures surface before the
      // socket is destroyed). Test fixtures bypass env validation, so the
      // ordering must hold here by construction.
      socketTimeoutMs: 6000,
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
  network?: StartedNetwork;
  networkAlias?: string;
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
    /** Attach the container to an explicit shared network (e.g. with Toxiproxy). */
    network?: StartedNetwork;
    /** Alias to address the container by inside the shared network. */
    networkAlias?: string;
  }): Promise<string> {
    const image = options?.image ?? 'postgres:17.6-alpine';
    const username = options?.username ?? 'neo_bank';
    const password = options?.password ?? 'test-password';
    const database = options?.database ?? 'neo_bank';

    let builder = new GenericContainer(image)
      .withEnvironment({
        POSTGRES_USER: username,
        POSTGRES_PASSWORD: password,
        POSTGRES_DB: database,
        // UTC-first storage policy (ADR-030): test containers match the
        // Compose stacks so SHOW TimeZone returns UTC everywhere.
        TZ: 'UTC',
      })
      .withExposedPorts(5432)
      // The message appears twice during first-boot initialization (before
      // and after the temporary server restart); waiting for two occurrences
      // means real startup completed.
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2));
    if (options?.network) {
      builder = builder
        .withNetwork(options.network)
        .withNetworkAliases(options?.networkAlias ?? 'postgres');
    }

    this.container = await builder.start();

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
  network?: StartedNetwork;
  networkAlias?: string;
}): Promise<{ postgres: TestPostgres; url: string }> {
  const postgres = new TestPostgres();
  const url = await postgres.start(options);
  return { postgres, url };
}

// Toxiproxy container-side ports: the REST API for fault control and the
// fixed port the test proxy listens on (the test process connects through
// the host-mapped port, so any fixed container-side port works).
const TOXIPROXY_API_PORT = 8474;
const TOXIPROXY_PROXY_PORT = 8666;

/**
 * Testcontainers-based Toxiproxy instance (ADR-036): a TCP proxy with
 * programmable faults, used to reproduce the established-connection network
 * black hole deterministically — packets silently dropped in both directions
 * while the TCP connection itself stays open, exactly the scenario the
 * bounded health probe must survive. Driven through Toxiproxy's REST API
 * with `fetch`, so no extra npm dependency is introduced.
 *
 * Start it on the same explicit network as the PostgreSQL container
 * (`startTestPostgres({ network, networkAlias })`), then point a proxy at the
 * in-network address.
 */
export class TestToxiproxy {
  private container: StartedTestContainer | null = null;
  private apiPort: number | null = null;
  private proxyPort: number | null = null;

  /**
   * Starts the Toxiproxy container (REST API and proxy port exposed to the
   * host; optionally attached to a shared container network). The image is
   * shell-less, so the wait strategy keys on the API startup log instead of
   * port inspection.
   */
  async start(options?: { image?: string; network?: StartedNetwork }): Promise<void> {
    const image = options?.image ?? 'ghcr.io/shopify/toxiproxy:2.12.0';
    let builder = new GenericContainer(image)
      .withExposedPorts(TOXIPROXY_API_PORT, TOXIPROXY_PROXY_PORT)
      .withWaitStrategy(Wait.forLogMessage('Starting Toxiproxy HTTP server', 1));
    if (options?.network) {
      builder = builder.withNetwork(options.network);
    }
    this.container = await builder.start();
    this.apiPort = this.container.getMappedPort(TOXIPROXY_API_PORT);
    this.proxyPort = this.container.getMappedPort(TOXIPROXY_PROXY_PORT);
  }

  /**
   * Returns the host-mapped proxy endpoint the test process connects to.
   * Must be called after `start()`.
   */
  getProxyEndpoint(): { host: string; port: number } {
    if (!this.container || this.proxyPort === null) {
      throw new Error('TestToxiproxy not started. Call start() first.');
    }
    return { host: this.container.getHost(), port: this.proxyPort };
  }

  private apiUrl(): string {
    if (!this.container || this.apiPort === null) {
      throw new Error('TestToxiproxy not started. Call start() first.');
    }
    return `http://${this.container.getHost()}:${this.apiPort}`;
  }

  /**
   * Creates a proxy listening on the container's proxy port, forwarding to
   * the upstream `host:port` (e.g. the PostgreSQL container's network alias).
   */
  async createProxy(name: string, upstreamHost: string, upstreamPort: number): Promise<void> {
    const response = await fetch(`${this.apiUrl()}/proxies`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        listen: `0.0.0.0:${TOXIPROXY_PROXY_PORT}`,
        upstream: `${upstreamHost}:${upstreamPort}`,
      }),
    });
    if (!response.ok) {
      throw new Error(`Creating Toxiproxy proxy "${name}" failed with HTTP ${response.status}.`);
    }
  }

  /**
   * Activates the black-hole fault: a `timeout` toxic on each stream with
   * `timeout: 0` (indefinite) stops data in both directions on affected
   * connections without closing them — established connections keep running
   * while every packet is silently dropped.
   */
  async addBlackHoleToxics(proxyName: string): Promise<void> {
    for (const stream of ['downstream', 'upstream'] as const) {
      const response = await fetch(`${this.apiUrl()}/proxies/${proxyName}/toxics`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: `blackhole-${stream}`,
          type: 'timeout',
          stream,
          toxicity: 1.0,
          attributes: { timeout: 0 },
        }),
      });
      if (!response.ok) {
        throw new Error(
          `Adding the black-hole toxic (${stream}) to "${proxyName}" failed with HTTP ${response.status}.`,
        );
      }
    }
  }

  /** Removes the black-hole toxics again, restoring plain forwarding. */
  async removeBlackHoleToxics(proxyName: string): Promise<void> {
    for (const stream of ['downstream', 'upstream'] as const) {
      const response = await fetch(
        `${this.apiUrl()}/proxies/${proxyName}/toxics/blackhole-${stream}`,
        { method: 'DELETE' },
      );
      if (!response.ok) {
        throw new Error(
          `Removing the black-hole toxic (${stream}) from "${proxyName}" failed with HTTP ${response.status}.`,
        );
      }
    }
  }

  /**
   * Stops and removes the container.
   * Safe to call multiple times.
   */
  async stop(): Promise<void> {
    if (this.container) {
      await this.container.stop();
      this.container = null;
      this.apiPort = null;
      this.proxyPort = null;
    }
  }
}
