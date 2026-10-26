import { RequestMethod, VersioningType } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { Test } from '@nestjs/testing';

import { AppModule } from '../src/app.module.js';
import serverConfig from '../src/shared/config/server.config.js';
import { fastifyGenReqId } from '../src/shared/http/request-id.js';
import { registerRequestIdLifecycle } from '../src/shared/http/request-id.lifecycle.js';

// Mirrors the bootstrap configuration in src/main.ts so e2e tests exercise
// the application exactly as it boots in production. Extra controllers are
// registered in the testing module's root so specs can exercise the global
// response/error contracts with throwaway routes.
export async function createTestApp(
  beforeInit?: (app: NestFastifyApplication) => void,
  options?: { controllers?: Type[] },
): Promise<NestFastifyApplication> {
  const { trustProxy, bodyLimit, corsOrigins } = serverConfig();

  const module = await Test.createTestingModule({
    imports: [AppModule],
    controllers: options?.controllers,
  }).compile();
  const app = module.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ trustProxy, bodyLimit, genReqId: fastifyGenReqId }),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'problems/application-error', method: RequestMethod.GET },
    ],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  if (corsOrigins) {
    app.enableCors({ origin: corsOrigins });
  }

  registerRequestIdLifecycle(app.getHttpAdapter().getInstance(), app.get(Logger));

  beforeInit?.(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return app;
}
