import { defineConfig } from '@mikro-orm/postgresql';
import type { PostgreSqlDriver } from '@mikro-orm/postgresql';

import { _env } from '#config/env/env.config.js';
import { buildMikroOrmOptions, CLI_ENTITY_PATHS } from './mikro-orm.options.js';

/**
 * Standalone CLI configuration (ADR-027): `mikro-orm debug` and the
 * `migration:*` commands cannot use Nest dependency injection, so the URL
 * comes from the shared env-validation layer instead of ConfigService — the
 * same validated value the runtime uses, loaded through the project's
 * standard `node --env-file` mechanism.
 *
 * The env-validation import uses the package `#` alias: this file sits inside
 * the package boundary, so Node resolves the specifier (to the compiled
 * output under dist/), keeping the CLI config free of parent-relative
 * imports.
 *
 * Shares all ORM settings with the runtime through buildMikroOrmOptions();
 * entity discovery paths come from CLI_ENTITY_PATHS in the same shared
 * module; `defineConfig` from the driver package injects the PostgreSQL
 * driver. The runtime's server-side statement_timeout safety net (ADR-036)
 * is explicitly disabled here: migrations may legitimately run long DDL, and
 * the deadline must never kill one mid-flight.
 */
export default defineConfig({
  ...buildMikroOrmOptions<PostgreSqlDriver>({
    clientUrl: _env.DATABASE_URL,
    poolMax: _env.DATABASE_POOL_MAX,
    // 0 → pg omits statement_timeout from the startup packet (server
    // default, off). See mikro-orm.options.ts.
    statementTimeoutMs: 0,
  }),
  ...CLI_ENTITY_PATHS,
});
