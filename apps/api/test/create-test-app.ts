import { RequestMethod, VersioningType } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';

import { AppModule } from '../src/app.module.js';
import serverConfig from '../src/shared/config/server.config.js';

// Mirrors the bootstrap configuration in src/main.ts so e2e tests exercise
// the application exactly as it boots in production.
export async function createTestApp(
  beforeInit?: (app: NestFastifyApplication) => void,
): Promise<NestFastifyApplication> {
  const { trustProxy, bodyLimit, corsOrigins } = serverConfig();

  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = module.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ trustProxy, bodyLimit }),
  );

  app.setGlobalPrefix('api', { exclude: [{ path: 'health', method: RequestMethod.GET }] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  if (corsOrigins) {
    app.enableCors({ origin: corsOrigins });
  }

  beforeInit?.(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return app;
}
