import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Head,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Sse,
  StreamableFile,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { z } from 'zod';

import { AppHttpException } from '#src/shared/errors/app-http.exception.js';
import { ErrorCode } from '#src/shared/errors/error.code.js';
import { ZodValidationPipe } from '#src/shared/pipes/zod-validation.pipe.js';

const CreateThingSchema = z.object({
  name: z.string().min(1),
  age: z.coerce.number().int().positive(),
});

const IdParamSchema = z.coerce.number().int().positive();

const SearchQuerySchema = z.object({
  limit: z.coerce.number().int().positive().default(10),
});

// Throwaway routes used by e2e specs to exercise the global response and
// error contracts. Registered only inside the testing module.
@Controller()
export class ContractController {
  @Get('echo')
  echo(): Record<string, unknown> {
    return { example: true };
  }

  @Post('things')
  create(): Record<string, unknown> {
    return { created: true };
  }

  @Get('no-content')
  @HttpCode(HttpStatus.NO_CONTENT)
  noContent(): undefined {
    return undefined;
  }

  @Get('not-modified')
  @HttpCode(HttpStatus.NOT_MODIFIED)
  notModified(): undefined {
    return undefined;
  }

  @Head('resource')
  head(): Record<string, unknown> {
    return { example: true };
  }

  @Get('file')
  file(): StreamableFile {
    return new StreamableFile(Buffer.from('file-content'));
  }

  @Get('text')
  @Header('Content-Type', 'text/plain')
  text(): string {
    return 'plain-text-body';
  }

  @Sse('events')
  events(): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      subscriber.next({ data: { hello: true } } satisfies MessageEvent);
      subscriber.complete();
    });
  }

  @Get('bad-array')
  badArray(): never {
    throw new BadRequestException(['name must be a string', 'age must be a number']);
  }

  @Post('validate/things')
  createValidatedThing(
    @Body(new ZodValidationPipe(CreateThingSchema)) body: z.infer<typeof CreateThingSchema>,
  ): z.infer<typeof CreateThingSchema> {
    return body;
  }

  @Get('validate/things/:id')
  getValidatedThing(@Param('id', new ZodValidationPipe(IdParamSchema)) id: number): { id: number } {
    return { id };
  }

  @Get('validate/search')
  search(
    @Query(new ZodValidationPipe(SearchQuerySchema)) query: z.infer<typeof SearchQuerySchema>,
  ): { limit: number } {
    return query;
  }

  @Get('missing')
  missing(): never {
    throw new NotFoundException('The requested resource was not found.');
  }

  @Get('app-error')
  appError(): never {
    throw new AppHttpException(
      ErrorCode.ApplicationError,
      'Something application-specific failed.',
      HttpStatus.CONFLICT,
    );
  }

  @Get('boom')
  boom(): never {
    throw new Error('database connection string postgres://secret');
  }
}
