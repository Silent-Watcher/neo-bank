import { RequestMethod, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';

import { AppModule } from './app.module.js';
import serverConfig from './shared/config/server.config.js';

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
    }),
  );

  // VERSION_NEUTRAL keeps /health out of URI versioning, but it does not
  // remove the global prefix, so the health route is explicitly excluded here.
  app.setGlobalPrefix('api', { exclude: [{ path: 'health', method: RequestMethod.GET }] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Only explicitly configured origins are granted access; when no origins
  // are configured, CORS stays disabled entirely instead of allowing every
  // origin, so requests never receive an Access-Control-Allow-Origin header.
  if (corsOrigins) {
    app.enableCors({ origin: corsOrigins });
  }

  app.enableShutdownHooks();
  await app.listen(port, host);
}

void bootstrap();
