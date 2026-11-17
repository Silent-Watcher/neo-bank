import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import type { IDatabaseDriver, Options } from '@mikro-orm/core';
import { Migrator } from '@mikro-orm/migrations';

// Bounds pg connection attempts at the pool level (SEC-02, Wave 14): pg's
// connectionTimeoutMillis defaults to 0 — an indefinite wait — and abandoned
// connection attempts from timed-out health probes would otherwise sit in the
// pool queue forever. The value sits above the health probe bound (3s) so the
// probe timeout, not the pool, is what the caller experiences, while the pool
// still reclaims every abandoned attempt (verified in pg-pool 3.14.0: the
// timer covers both new dials and queued acquisitions). ADR-036.
const DATABASE_POOL_CONNECT_TIMEOUT_MS = 5000;

// Server-enforced statement deadline for the runtime pool (ADR-036): a
// generous hang safety net so a lock-wait or runaway statement cannot hold a
// pool session forever when the network is healthy. It deliberately does not
// protect against black-holed clients (the server-side abort never reaches a
// client whose packets are dropped) — see ADR-036 for that mechanism. pg
// sends `statement_timeout` as a startup-packet parameter and omits falsy
// values from it (verified in pg 8.23.1 client.js), so 0 means "server
// default, off" — the CLI migration configuration passes 0 because
// migrations may legitimately run long DDL.
const DATABASE_STATEMENT_TIMEOUT_MS = 30_000;

// Explicit pool sizing instead of library defaults (ADR-036): idle clients
// above `min` are closed after 10s (pg's implicit default, now documented),
// and TCP keepalive detects dead peers on idle connections (it cannot detect
// a black-holed in-flight query — the OS retransmission timeout governs
// those; ADR-036 documents the limitation). The pool capacity itself is the
// `poolMax` option, sourced from the DATABASE_POOL_MAX environment variable.
const DATABASE_POOL_IDLE_TIMEOUT_MS = 10_000;
const DATABASE_POOL_KEEP_ALIVE_INITIAL_DELAY_MS = 10_000;

// The default pool capacity, mirrored as the DATABASE_POOL_MAX schema default
// in db.env.ts (the env layer cannot import from the database layer, so the
// default is stated in both places and cross-referenced). Callers that do not
// read the validated environment — the test overrides of
// MIKRO_ORM_MODULE_OPTIONS — pass this value explicitly.
export const DATABASE_POOL_MAX_DEFAULT = 10;

/**
 * Settings shared by the NestJS runtime configuration and the standalone CLI
 * configuration (ADR-027): database connection, pool sizing, statement
 * deadline, metadata provider, entity discovery behavior, and migrations.
 * Only the database URL is supplied by the caller — explicit configuration
 * has precedence over environment variables in MikroORM v7, so the URL is
 * always passed explicitly by the ConfigService (runtime) or the validated
 * environment (CLI) and never read here from `process.env`.
 */
export interface MikroOrmSharedOptions {
  clientUrl: string;
  /** Pool capacity; the caller sources it from DATABASE_POOL_MAX (default 10). */
  poolMax: number;
  /** Server-side statement_timeout; the CLI passes 0 to disable it. */
  statementTimeoutMs: number;
}

export function buildMikroOrmOptions<D extends IDatabaseDriver = IDatabaseDriver>({
  clientUrl,
  poolMax,
  statementTimeoutMs,
}: MikroOrmSharedOptions): Omit<Partial<Options<D>>, 'driver'> {
  return {
    // Reaches the underlying pg Pool via driverOptions → mapOptions; the
    // typed PoolConfig surface only exposes min/max/idleTimeoutMillis. Pool
    // options flow to every `new Client(options)` too, which is what carries
    // statement_timeout and the keepalive knobs.
    driverOptions: {
      connectionTimeoutMillis: DATABASE_POOL_CONNECT_TIMEOUT_MS,
      max: poolMax,
      idleTimeoutMillis: DATABASE_POOL_IDLE_TIMEOUT_MS,
      statement_timeout: statementTimeoutMs,
      keepAlive: true,
      keepAliveInitialDelayMillis: DATABASE_POOL_KEEP_ALIVE_INITIAL_DELAY_MS,
    },
    // The legacy decorators read the design:* metadata the existing SWC +
    // tsc pipeline emits; v7 requires the provider to be configured
    // deliberately (explicit here regardless of the library default).
    metadataProvider: ReflectMetadataProvider,
    // UTC-first storage policy (ADR-030): forces UTC serialization for
    // timezone-less datetime columns. Verified supported in 7.2.9 (and the
    // installed default) — set explicitly to document the policy; it does
    // not replace the TIMESTAMPTZ column types, which store absolute
    // instants regardless.
    forceUtcTimezone: true,
    clientUrl,
    // ADR-027: schema changes go exclusively through explicit SQL
    // migrations — no schema synchronization is configured anywhere, and
    // none is ever added.
    migrations: {
      // Paths are relative to the API workspace root, where every script
      // (dev server, CLI) executes.
      path: 'dist/shared/database/migrations',
      pathTs: 'src/shared/database/migrations',
    },
    extensions: [Migrator],
  };
}

/**
 * Entity discovery paths for the MikroORM CLI, which cannot see the
 * runtime's autoLoadEntities mechanism (only forFeature registrations).
 * Entities live in each feature's `entities/` folder — one entity per file,
 * `<name>.entity.ts` — so the CLI discovers them from the compiled output
 * and from the TypeScript sources. New feature entities need no change
 * here as long as they follow that folder convention.
 */
export const CLI_ENTITY_PATHS: { entities: string[]; entitiesTs: string[] } = {
  entities: ['dist/modules/*/entities/*.entity.js'],
  entitiesTs: ['src/modules/*/entities/*.entity.ts'],
};

/**
 * The exact runtime factory output the NestJS module registers: the shared
 * options plus the NestJS-specific autoLoadEntities (entities added through
 * MikroOrmModule.forFeature() are appended automatically; the CLI cannot see
 * this mechanism and configures its own discovery paths in
 * mikro-orm.config.ts). Test overrides of MIKRO_ORM_MODULE_OPTIONS must
 * reproduce this shape — building it here keeps one source of truth for it.
 * The driver is supplied beside useFactory by the module (the v7
 * requirement) and must ride along in overrides that replace the whole
 * options object.
 */
export function buildRuntimeMikroOrmOptions(
  clientUrl: string,
  poolMax: number,
): Omit<Partial<Options>, 'driver'> & { autoLoadEntities: true } {
  return {
    ...buildMikroOrmOptions({
      clientUrl,
      poolMax,
      statementTimeoutMs: DATABASE_STATEMENT_TIMEOUT_MS,
    }),
    autoLoadEntities: true,
  };
}
