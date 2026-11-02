import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { successEnvelopeSchema } from '#src/shared/swagger/openapi.schemas.js';
import { AppService } from './app.service.js';

@ApiTags('app')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({
    summary: 'Application greeting',
    description: 'Simple smoke-check endpoint under the versioned API surface.',
  })
  @ApiOkResponse({
    description: 'Greeting message, wrapped in the standard response envelope.',
    schema: successEnvelopeSchema({ type: 'string' }),
  })
  getHello(): string {
    return this.appService.getHello();
  }
}
