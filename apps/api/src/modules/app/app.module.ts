import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { TerminusModule } from '@nestjs/terminus';
import { configModule } from '#config/config.js';
import { ProblemDetailsFilter } from '#filters/problem-details.filter.js';
import { ResponseEnvelopeInterceptor } from '#interceptors/response-envelope.interceptor.js';
import { MemoryProtectionModule } from '#src/shared/memory-protection/memory-protection.module.js';
import { MemoryProtectionGuard } from '#src/shared/memory-protection/memory-protection.guard.js';
import { AppLoggerModule } from '#src/shared/logging/logger.module.js';
import { i18nModule } from '#src/shared/i18n/i18n.module.js';
import { RedisModule } from '#redis/redis.module.js';
import { DatabaseModule } from '#database/database.module.js';
import { RedisThrottlerGuard } from '#src/shared/throttler/redis-throttler.guard.js';
import { throttlerModule } from '#src/shared/throttler/throttler.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { HealthController } from './health.controller.js';
import { ProblemsController } from './problems.controller.js';
import { EnrollmentsModule } from '#modules/enrollments/enrollments.module.js';

@Module({
  imports: [
    configModule,
    i18nModule,
    AppLoggerModule,
    TerminusModule,
    RedisModule,
    DatabaseModule,
    MemoryProtectionModule,
    throttlerModule,
    EnrollmentsModule,
  ],
  controllers: [AppController, HealthController, ProblemsController],
  providers: [
    AppService,
    // Memory protection rejects before the throttler guard so a protected
    // process sheds load through the cheapest path — no Redis round trip
    // (ADR-026). Guard order follows provider order.
    { provide: APP_GUARD, useClass: MemoryProtectionGuard },
    { provide: APP_GUARD, useClass: RedisThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
