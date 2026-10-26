import {
  BadRequestException,
  Controller,
  Get,
  Head,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Sse,
  StreamableFile,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';

import { AppHttpException } from '../src/shared/errors/app-http.exception.js';
import { ErrorCode } from '../src/shared/errors/error.code.js';

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
