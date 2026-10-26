import { RequestMethod, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module.js';
import serverConfig from './shared/config/server.config.js';
import { fastifyGenReqId } from './shared/http/request-id.js';
import { registerRequestIdLifecycle } from './shared/http/request-id.lifecycle.js';

async function bootstrap() {
  const { host, port, trustProxy, bodyLimit, corsOrigins } = serverConfig();

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
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'problems/application-error', method: RequestMethod.GET },
    ],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Only explicitly configured origins are granted access; when no origins
  // are configured, CORS stays disabled entirely instead of allowing every
  // origin, so requests never receive an Access-Control-Allow-Origin header.
  if (corsOrigins) {
    app.enableCors({ origin: corsOrigins });
  }

  // Fastify-level request-ID lifecycle: x-request-id echo on every response
  // and early rejection of invalid inbound IDs, before any route handler runs.
  registerRequestIdLifecycle(app.getHttpAdapter().getInstance(), app.get(Logger));

  app.enableShutdownHooks();
  await app.listen(port, host);
}

void bootstrap();
