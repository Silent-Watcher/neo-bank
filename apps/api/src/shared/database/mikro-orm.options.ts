import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import type { IDatabaseDriver, Options } from '@mikro-orm/core';
import { Migrator } from '@mikro-orm/migrations';

// Bounds pg connection attempts at the pool level (SEC-02, Wave 14): pg's
// connectionTimeoutMillis defaults to 0 — an indefinite wait — and abandoned
// connection attempts from timed-out health probes would otherwise sit in the
// pool queue forever. The value sits above the health probe bound (3s) so the
// probe timeout, not the pool, is what the caller experiences, while the pool
// still reclaims every abandoned attempt.
const DATABASE_POOL_CONNECT_TIMEOUT_MS = 5000;

/**
 * Settings shared by the NestJS runtime configuration and the standalone CLI
 * configuration (ADR-027): database connection, metadata provider, entity
 * discovery behavior, and migrations. Only the database URL is supplied by
 * the caller — explicit configuration has precedence over environment
 * variables in MikroORM v7, so the URL is always passed explicitly by the
 * ConfigService (runtime) or the validated environment (CLI) and never read
 * here from `process.env`.
 */
export interface MikroOrmSharedOptions {
  clientUrl: string;
}

export function buildMikroOrmOptions<D extends IDatabaseDriver = IDatabaseDriver>({
  clientUrl,
}: MikroOrmSharedOptions): Omit<Partial<Options<D>>, 'driver'> {
  return {
    // Reaches the underlying pg Pool via driverOptions → mapOptions; the
    // typed PoolConfig surface only exposes min/max/idleTimeoutMillis.
    driverOptions: {
      connectionTimeoutMillis: DATABASE_POOL_CONNECT_TIMEOUT_MS,
    },
    // The legacy decorators read the design:* metadata the existing SWC +
    // tsc pipeline emits; v7 requires the provider to be configured
    // deliberately (explicit here regardless of the library default).
    metadataProvider: ReflectMetadataProvider,
    // ADR-027 is infrastructure-only: no entities exist yet, so discovery
    // must not warn. The first feature entity can drop this override.
    discovery: { warnWhenNoEntities: false },
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
 * and from the TypeScript sources. No entities exist yet; the first feature
 * entity needs no change here.
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
): Omit<Partial<Options>, 'driver'> & { autoLoadEntities: true } {
  return {
    ...buildMikroOrmOptions({ clientUrl }),
    autoLoadEntities: true,
  };
}
