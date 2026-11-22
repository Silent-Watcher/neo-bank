import { MIKRO_ORM_MODULE_OPTIONS } from '@mikro-orm/nestjs';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';

import { BaseEntity } from '#database/base.entity.js';
import { Enrollment } from '#modules/enrollments/entities/enrollment.entity.js';
import {
  buildRuntimeMikroOrmOptions,
  DATABASE_POOL_MAX_DEFAULT,
} from '#database/mikro-orm.options.js';

import { createTestApp } from './create-test-app.js';

/**
 * Boots the fully wired AppModule against the caller's Testcontainers
 * PostgreSQL URL (ADR-016), shared by the db-spec suites that boot the real
 * AppModule — the enrollment suite and the database-lifecycle suite — so
 * the ORM-options override rationale lives here exactly once. (The
 * migration-replay parity suite initializes MikroORM directly and does not
 * use this helper.)
 */
export function createProbeApp(databaseUrl: string) {
  return createTestApp(undefined, {
    configureModule: (builder) => {
      // The ORM options themselves are supplied (not the DATABASE_CONFIG
      // namespace token — ConfigService holds the registerAs factory result
      // and does not observe provider overrides on it). Both entities are
      // listed explicitly (the MikroORM rule for explicit entity lists):
      // with autoLoadEntities on, @mikro-orm/nestjs copies forFeature
      // registrations into `entitiesTs`, and TS-mode discovery (Vitest)
      // uses `entitiesTs` INSTEAD of `entities` — the override must not
      // depend on that path.
      builder.overrideProvider(MIKRO_ORM_MODULE_OPTIONS).useValue({
        driver: PostgreSqlDriver,
        ...buildRuntimeMikroOrmOptions(databaseUrl, DATABASE_POOL_MAX_DEFAULT),
        entities: [BaseEntity, Enrollment],
        autoLoadEntities: false,
      });
      // Redis keeps the validation-only placeholder from env/.env.db-test,
      // so the throttler storage is swapped for the official in-memory
      // service.
      builder.overrideProvider(ThrottlerStorage).useValue(new ThrottlerStorageService());
    },
  });
}
