import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { TerminusModule } from '@nestjs/terminus';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { HealthController } from './health.controller.js';
import { ProblemsController } from './problems.controller.js';
import { configModule } from './shared/config/config.js';
import { ProblemDetailsFilter } from './shared/filters/problem-details.filter.js';
import { ResponseEnvelopeInterceptor } from './shared/interceptors/response-envelope.interceptor.js';
import { AppLoggerModule } from './shared/logging/logger.module.js';

@Module({
  imports: [configModule, AppLoggerModule, TerminusModule],
  controllers: [AppController, HealthController, ProblemsController],
  providers: [
    AppService,
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
