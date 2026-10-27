import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import type { Params } from 'nestjs-pino';

import type { LogConfig } from '#config/log.config.js';
import { LOG_CONFIG } from '#config/log.config.js';
import { buildPinoHttpOptions } from './pino-http.options.js';

// Replaces NestJS's default system logger with Pino and runs the single
// pino-http access-log pipeline with request-scoped log context.
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService): Params => ({
        pinoHttp: buildPinoHttpOptions(configService.getOrThrow<LogConfig>(LOG_CONFIG)),
      }),
    }),
  ],
})
export class AppLoggerModule {}
