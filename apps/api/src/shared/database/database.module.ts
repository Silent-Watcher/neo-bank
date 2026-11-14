import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';

import { DATABASE_CONFIG } from '#config/database.config.js';
import type { DatabaseConfig } from '#config/database.config.js';

import { DatabaseConnectionInitializer } from './database.connect.js';
import { DatabaseHealthIndicator } from './database.health.js';
import { buildRuntimeMikroOrmOptions } from './mikro-orm.options.js';

/**
 * Global database integration module (ADR-027). Registered exactly once
 * (AppModule); its exports are available to every feature module without
 * importing it.
 *
 * MikroORM v7 initializes without connecting; the initial connection is
 * established during bootstrap by {@link DatabaseConnectionInitializer} with
 * bounded retries (ADR-027 amendment) — startup fails when the database
 * cannot be reached. After a successful boot, an unreachable PostgreSQL
 * degrades `/health` (HTTP 200) and fails `/health/ready` (503) through
 * {@link DatabaseHealthIndicator}. The integration closes the connection
 * during application shutdown (`enableShutdownHooks()` in main.ts), so no
 * duplicate lifecycle handling exists here.
 *
 * TerminusModule supplies HealthIndicatorService for the health indicator;
 * it is the same plain module AppModule imports, so no duplicate Terminus
 * providers are created.
 */
@Global()
@Module({
  imports: [
    MikroOrmModule.forRootAsync({
      // v7: the driver must be supplied beside useFactory so the
      // integration can register the driver-specific EntityManager token
      // (injecting PostgreSqlEntityManager from the driver package would
      // otherwise fail to resolve).
      driver: PostgreSqlDriver,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const { url } = configService.getOrThrow<DatabaseConfig>(DATABASE_CONFIG);

        return buildRuntimeMikroOrmOptions(url);
      },
    }),
    TerminusModule,
  ],
  providers: [DatabaseConnectionInitializer, DatabaseHealthIndicator],
  exports: [DatabaseHealthIndicator],
})
export class DatabaseModule {}
