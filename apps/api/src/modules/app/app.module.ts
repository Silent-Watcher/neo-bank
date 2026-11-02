import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { TerminusModule } from '@nestjs/terminus';
import { configModule } from '#config/config.js';
import { ProblemDetailsFilter } from '#filters/problem-details.filter.js';
import { ResponseEnvelopeInterceptor } from '#interceptors/response-envelope.interceptor.js';
import { AppLoggerModule } from '#src/shared/logging/logger.module.js';
import { RedisModule } from '#src/shared/redis/redis.module.js';
import { EnrollemntsModule } from '#modules/enrollemnts/enrollemnts.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { HealthController } from './health.controller.js';
import { ProblemsController } from './problems.controller.js';

@Module({
  imports: [
    configModule,
    AppLoggerModule,
    TerminusModule,
    RedisModule,
    EnrollemntsModule,
  ],
  controllers: [AppController, HealthController, ProblemsController],
  providers: [
    AppService,
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule { }
