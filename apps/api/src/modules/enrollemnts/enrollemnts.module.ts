import { Module } from '@nestjs/common';
import { EnrollemntsService } from './enrollemnts.service.js';
import { EnrollemntsController } from './enrollemnts.controller.js';

@Module({
  controllers: [EnrollemntsController],
  providers: [EnrollemntsService],
})
export class EnrollemntsModule {}
