import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import { ThrottlerEnforcementModule } from '#src/shared/throttler/throttler-enforcement.module.js';

import { Enrollment } from './entities/enrollment.entity.js';
import { EnrollmentsService } from './enrollments.service.js';
import { EnrollmentsController } from './enrollments.controller.js';

@Module({
  controllers: [EnrollmentsController],
  providers: [EnrollmentsService],
  imports: [MikroOrmModule.forFeature([Enrollment]), ThrottlerEnforcementModule],
})
export class EnrollmentsModule {}
