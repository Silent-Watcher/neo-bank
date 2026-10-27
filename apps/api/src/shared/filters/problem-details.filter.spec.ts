import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { FastifyReply, FastifyRequest } from 'fastify';
import { PinoLogger } from 'nestjs-pino';

import { AppHttpException } from '#errors/app-http.exception.js';
import { ErrorCode } from '#errors/error.code.js';
import { ProblemDetailsFilter } from './problem-details.filter.js';

const REQUEST_ID = '550e8400-e29b-41d4-a716-446655440000';

function createFilterFixture(requestUrl = '/api/v1/hello') {
  const replySend = vi.fn();

  const reply = {
    statusCode: 200,
    status: vi.fn(function this_(status: number) {
      reply.statusCode = status;
      return reply;
    }) as unknown as FastifyReply['status'],
    header: vi.fn(() => reply) as unknown as FastifyReply['header'],
    send: replySend,
  } as unknown as FastifyReply;

  const request = { id: REQUEST_ID, url: requestUrl } as unknown as FastifyRequest;

  const host = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => reply }),
  } as unknown as ArgumentsHost;

  const logger = { error: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;

  // return { filter: new ProblemDetailsFilter(logger), reply, replySend, logger };
  return { filter: new ProblemDetailsFilter(logger), reply, replySend, logger, host };
}

describe('ProblemDetailsFilter', () => {
  it('normalizes built-in HTTP exceptions into Problem Details', () => {
    // const { filter, replySend } = createFilterFixture();
    const { filter, replySend, host } = createFilterFixture();

    // filter.catch(new NotFoundException('The requested resource was not found.'), {} as never);
    filter.catch(new NotFoundException('The requested resource was not found.'), host);

    expect(replySend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'about:blank',
        title: 'Not Found',
        status: 404,
        detail: 'The requested resource was not found.',
        apiVersion: 'v1',
        requestId: REQUEST_ID,
        code: ErrorCode.NotFound,
      }),
    );
    const body = replySend.mock.calls[0][0] as Record<string, unknown>;
    expect(body).not.toHaveProperty('message');
    expect(new Date(body.timestamp as string).toISOString()).toBe(body.timestamp);
  });

  it('sets the Problem Details media type and request ID headers', () => {
    // const { filter, reply } = createFilterFixture();
    const { filter, reply, host } = createFilterFixture();
    const headerSpy = reply.header as ReturnType<typeof vi.fn>;

    // filter.catch(new NotFoundException(), {} as never);
    filter.catch(new NotFoundException(), host);

    expect(headerSpy).toHaveBeenCalledWith('content-type', 'application/problem+json');
    expect(headerSpy).toHaveBeenCalledWith('x-request-id', REQUEST_ID);
    expect(reply.status).toHaveBeenCalledWith(404);
  });

  it('joins validation message arrays into a readable detail', () => {
    // const { filter, replySend } = createFilterFixture();
    const { filter, replySend, host } = createFilterFixture();

    // filter.catch(
    //   new BadRequestException(['name must be a string', 'age must be a number']),
    //   {} as never,
    // );

    filter.catch(new BadRequestException(['name must be a string', 'age must be a number']), host);

    expect(replySend).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 400,
        detail: 'name must be a string; age must be a number',
        code: ErrorCode.BadRequest,
      }),
    );
  });

  it('normalizes AppHttpException with its typed code and family Problem Type', () => {
    // const { filter, replySend } = createFilterFixture();
    const { filter, replySend, host } = createFilterFixture();

    // filter.catch(
    //   new AppHttpException(
    //     ErrorCode.ApplicationError,
    //     'Something application-specific failed.',
    //     HttpStatus.CONFLICT,
    //   ),
    //   {} as never,
    // );

    filter.catch(
      new AppHttpException(
        ErrorCode.ApplicationError,
        'Something application-specific failed.',
        HttpStatus.CONFLICT,
      ),
      host,
    );

    expect(replySend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: '/problems/application-error',
        title: 'Application Error',
        status: 409,
        detail: 'Something application-specific failed.',
        code: ErrorCode.ApplicationError,
      }),
    );
  });

  it('normalizes unknown exceptions into a safe generic 500', () => {
    // const { filter, replySend } = createFilterFixture();
    const { filter, replySend, host } = createFilterFixture();

    // filter.catch(new Error('database connection string postgres://secret'), {} as never);
    filter.catch(new Error('database connection string postgres://secret'), host);

    expect(replySend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: '/problems/application-error',
        title: 'Application Error',
        status: 500,
        detail: 'An unexpected error occurred.',
        code: ErrorCode.ApplicationError,
      }),
    );
    const body = replySend.mock.calls[0][0] as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toContain('postgres://secret');
  });

  it('logs unexpected server errors at error severity with the exception', () => {
    // const { filter, logger } = createFilterFixture();
    const { filter, logger, host } = createFilterFixture();
    const original = new Error('boom');

    // filter.catch(original, {} as never);
    filter.catch(original, host);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: original }),
      'Unhandled exception',
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs expected client errors at warn severity only', () => {
    // const { filter, logger } = createFilterFixture();
    const { filter, logger, host } = createFilterFixture();

    // filter.catch(new NotFoundException(), {} as never);
    filter.catch(new NotFoundException(), host);

    expect(logger.warn).toHaveBeenCalledWith('HTTP 404 NOT_FOUND');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('derives the API version from the request URI on the error path', () => {
    // const { filter, replySend } = createFilterFixture('/health');
    const { filter, replySend, host } = createFilterFixture('/health');

    // filter.catch(new NotFoundException(), {} as never);
    filter.catch(new NotFoundException(), host);

    expect(replySend).toHaveBeenCalledWith(expect.objectContaining({ apiVersion: 'neutral' }));
  });
});
