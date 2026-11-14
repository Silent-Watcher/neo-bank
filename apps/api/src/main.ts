import { RequestMethod, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';

import { AppEnv } from '#enums/app-env.enum.js';
import { AppModule } from './modules/app/app.module.js';
import serverConfig from './shared/config/server.config.js';
import { fastifyGenReqId } from './shared/http/request-id.js';
import { registerRequestIdLifecycle } from './shared/http/request-id.lifecycle.js';
import {
  buildStartupLogMessage,
  buildStartupUrl,
  resolveStartupAddresses,
} from './shared/http/startup-url.js';
import { setupSwagger, SWAGGER_DOCS_PATH } from '#swagger/swagger.setup.js';

// Single source of truth for the API's externally visible base path: the
// registrations below compose their values from these constants, and the
// startup log builds its URLs from them. When a new API version ships, edit
// the prefix/version constants — everything else follows.
const API_GLOBAL_PREFIX = 'api';
const API_DEFAULT_VERSION = '1';
const API_BASE_PATH = `/${API_GLOBAL_PREFIX}/v${API_DEFAULT_VERSION}`;

async function bootstrap() {
  const {
    env,
    host,
    port,
    trustProxy,
    bodyLimit,
    corsOrigins,
    redisInsightUrl,
    mockserverHostUrl,
    mockserverDockerUrl,
  } = serverConfig();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      // When the application runs behind a trusted reverse proxy or load
      // balancer, forwarded headers are needed to determine the original client
      // IP and protocol. Trusting forwarded headers without a properly
      // configured trusted proxy would let clients spoof their address, so
      // proxy trust stays off unless explicitly enabled.
      trustProxy,
      // Caps the maximum request payload size in bytes to reduce unnecessary
      // memory consumption and limit the impact of oversized-payload abuse.
      bodyLimit,
      // Single source of truth for request IDs: an inbound x-request-id header
      // is accepted only as a valid UUIDv4 (normalized to lowercase); every
      // other request gets a freshly generated crypto.randomUUID(). Pino and
      // the response envelopes reuse this Fastify-assigned ID.
      genReqId: fastifyGenReqId,
    }),
    // Early bootstrap logs are buffered until the Pino logger takes over.
    { bufferLogs: true },
  );

  // Replaces the default NestJS logger so framework and application logs use
  // the same Pino pipeline.
  app.useLogger(app.get(Logger));

  // VERSION_NEUTRAL keeps /health and the Problem Type page out of URI
  // versioning, but it does not remove the global prefix, so both routes are
  // explicitly excluded here. This keeps /problems/application-error serving
  // at exactly the URI used as the Problem Type in error responses.
  app.setGlobalPrefix(API_GLOBAL_PREFIX, {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
      { path: 'problems/application-error', method: RequestMethod.GET },
    ],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: API_DEFAULT_VERSION });

  // Only explicitly configured origins are granted access; when no origins
  // are configured, CORS stays disabled entirely instead of allowing every
  // origin, so requests never receive an Access-Control-Allow-Origin header.
  if (corsOrigins) {
    app.enableCors({ origin: corsOrigins });
  }

  // Fastify-level request-ID lifecycle: x-request-id echo on every response
  // and early rejection of invalid inbound IDs, before any route handler runs.
  registerRequestIdLifecycle(app.getHttpAdapter().getInstance(), app.get(Logger));

  // Swagger is a development aid only: it must not appear in e2e route
  // expectations (test) or expose the API surface publicly (production), so
  // the routes are registered exclusively in the development environment.
  // The startup log derives its Swagger section from this same binding, so
  // the URL is only ever logged when the routes actually exist.
  const isSwaggerEnabled = env === AppEnv.Development;
  if (isSwaggerEnabled) {
    setupSwagger(app);
  }

  app.enableShutdownHooks();
  await app.listen(port, host);

  // Startup address logging: URLs use the real prefix/version path and the
  // Swagger URL appears only when Swagger is registered. Inside containers
  // the interface addresses are container-internal; the host-published port
  // is not knowable from here and is never claimed.
  const addresses = resolveStartupAddresses(host);
  const toUrls = (path: string) => addresses.map((address) => buildStartupUrl(address, port, path));
  const swaggerUrls = isSwaggerEnabled ? toUrls(`/${SWAGGER_DOCS_PATH}`) : null;
  // The MockServer addresses are only logged where the development Compose
  // stack actually runs the service: it injects both URLs, and the
  // development gate keeps a stray value in any other environment from
  // advertising an address that does not exist there.
  const isMockServerConfigured =
    mockserverHostUrl !== undefined || mockserverDockerUrl !== undefined;
  const mockserverUrls =
    env === AppEnv.Development && isMockServerConfigured
      ? { host: mockserverHostUrl ?? null, docker: mockserverDockerUrl ?? null }
      : null;
  // The Redis Insight URL is only logged where it is actually exposed: the
  // development Compose stack injects it; everywhere else it is unset.
  app.get(Logger).log(
    buildStartupLogMessage({
      apiUrls: toUrls(API_BASE_PATH),
      swaggerUrls,
      mockserverUrls,
      redisInsightUrl: redisInsightUrl ?? null,
    }),
  );
}

void bootstrap();
