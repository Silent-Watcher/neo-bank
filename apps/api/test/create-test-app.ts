import type { Type } from '@nestjs/common';
import { RequestMethod, VersioningType } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { TestingModuleBuilder } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import { Logger } from 'nestjs-pino';

import { AppModule } from '#src/modules/app/app.module.js';
import { REDIS_CLIENT } from '#src/shared/redis/redis.constants.js';
import serverConfig from '#src/shared/config/server.config.js';
import { fastifyGenReqId } from '#src/shared/http/request-id.js';
import { registerRequestIdLifecycle } from '#src/shared/http/request-id.lifecycle.js';

// Mirrors the bootstrap configuration in src/main.ts so e2e tests exercise
// the application exactly as it boots in production. Extra controllers are
// registered in the testing module's root so specs can exercise the global
// response/error contracts with throwaway routes; configureModule lets specs
// override providers (e.g. the logger params) before the module compiles.
// adapterTrustProxy overrides the validated TRUST_PROXY value for specs that
// verify proxy-trust behavior itself.
export async function createTestApp(
  beforeInit?: (app: NestFastifyApplication) => void,
  options?: {
    controllers?: Type[];
    configureModule?: (builder: TestingModuleBuilder) => void;
    adapterTrustProxy?: boolean;
  },
): Promise<NestFastifyApplication> {
  const { trustProxy, bodyLimit, corsOrigins } = serverConfig();

  const moduleBuilder = Test.createTestingModule({
    imports: [AppModule],
    controllers: options?.controllers,
  });
  options?.configureModule?.(moduleBuilder);
  const module = await moduleBuilder.compile();
  const app = module.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({
      trustProxy: options?.adapterTrustProxy ?? trustProxy,
      bodyLimit,
      genReqId: fastifyGenReqId,
    }),
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
  // The Redis connection is initiated in the background at init; guarded
  // routes fail closed (500) until it is ready. Deployments gate traffic on
  // the health probe the same way — connect the client when a spec stubbed
  // RedisService (nobody else would), wait (bounded) for readiness, and
  // close what this helper opened when the spec closes the app.
  const client = app.get<Redis>(REDIS_CLIENT, { strict: false });
  let ownedConnection = false;
  if (client && client.status === 'wait') {
    ownedConnection = true;
    void client.connect().catch(() => undefined);
  }
  const deadline = Date.now() + 2000;
  while (client && client.status !== 'ready' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (ownedConnection) {
    const originalClose = app.close.bind(app);
    app.close = async (): Promise<void> => {
      await originalClose();
      client.disconnect();
    };
  }
  await app.getHttpAdapter().getInstance().ready();

  return app;
}
