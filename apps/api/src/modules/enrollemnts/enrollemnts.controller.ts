import { Controller } from '@nestjs/common';
import { EnrollemntsService } from './enrollemnts.service.js';

@Controller('enrollemnts')
export class EnrollemntsController {
  constructor(private readonly enrollemntsService: EnrollemntsService) {}
}
