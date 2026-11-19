import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import { throttlerModule } from '#src/shared/throttler/throttler.module.js';
import { RedisThrottlerGuard } from '#src/shared/throttler/redis-throttler.guard.js';

import { Enrollment } from './entities/enrollment.entity.js';
import { EnrollmentsService } from './enrollments.service.js';
import { EnrollmentsController } from './enrollments.controller.js';

@Module({
  controllers: [EnrollmentsController],
  providers: [EnrollmentsService, RedisThrottlerGuard],
  imports: [MikroOrmModule.forFeature([Enrollment]), throttlerModule],
})
export class EnrollmentsModule {}
