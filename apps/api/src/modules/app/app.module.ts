import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { TerminusModule } from '@nestjs/terminus';
import { configModule } from '#config/config.js';
import { actorContextModule } from '#src/shared/actor-context/actor-context.module.js';
import { ProblemDetailsFilter } from '#filters/problem-details.filter.js';
import { ResponseEnvelopeInterceptor } from '#interceptors/response-envelope.interceptor.js';
import { ConditionalRequestInterceptor } from '#http/conditional-request.interceptor.js';
import { MemoryProtectionModule } from '#src/shared/memory-protection/memory-protection.module.js';
import { MemoryProtectionGuard } from '#src/shared/memory-protection/memory-protection.guard.js';
import { AppLoggerModule } from '#src/shared/logging/logger.module.js';
import { i18nModule } from '#src/shared/i18n/i18n.module.js';
import { RedisModule } from '#redis/redis.module.js';
import { DatabaseModule } from '#database/database.module.js';
import { DeferredRateLimitGuard } from '#src/shared/throttler/deferred-rate-limit.guard.js';
import { throttlerModule } from '#src/shared/throttler/throttler.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { HealthController } from './health.controller.js';
import { ProblemsController } from './problems.controller.js';
import { EnrollmentsModule } from '#modules/enrollments/enrollments.module.js';
import { IdempotencyStoreModule } from '#src/shared/idempotency/idempotency.module.js';

@Module({
  imports: [
    configModule,
    // Opens the per-request actor context (ADR-031) ahead of every guard,
    // interceptor, and handler, so audit attribution resolves for any ORM
    // write in the request chain.
    actorContextModule,
    i18nModule,
    AppLoggerModule,
    TerminusModule,
    RedisModule,
    DatabaseModule,
    MemoryProtectionModule,
    throttlerModule,
    EnrollmentsModule,
    IdempotencyStoreModule,
  ],
  controllers: [AppController, HealthController, ProblemsController],
  providers: [
    AppService,
    // Memory protection rejects before the throttler guard so a protected
    // process sheds load through the cheapest path — no Redis round trip
    // (ADR-026). Guard order follows provider order.
    { provide: APP_GUARD, useClass: MemoryProtectionGuard },
    { provide: APP_GUARD, useClass: DeferredRateLimitGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    // Registered after the envelope interceptor, so it wraps INSIDE it and
    // sees the handler payload before the envelope adds its per-response
    // metadata: the ETag validates the application payload (a weak validator,
    // since the wire body carries fresh timestamp/request ID per response).
    // ADR-032: conditional-request support.
    { provide: APP_INTERCEPTOR, useClass: ConditionalRequestInterceptor },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
