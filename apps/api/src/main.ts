import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';

import { AppModule } from './app.module.js';
import type { ServerConfig } from './shared/config/server.config.js';
import { SERVER_CONFIG } from './shared/config/server.config.js';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  app.enableShutdownHooks();
  const serverConfig = app.get(ConfigService).get<ServerConfig>(SERVER_CONFIG);
  if (!serverConfig) throw new Error('server config is undefined');
  const { host, port } = serverConfig;
  await app.listen(port, host);
}

void bootstrap();
