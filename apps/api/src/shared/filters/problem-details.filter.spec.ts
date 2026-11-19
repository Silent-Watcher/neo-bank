import {
  BadRequestException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { HttpRequestLike, HttpResponseLike } from '#http/http-boundary.js';
import { I18nContext, I18nService } from '@nestjs/i18n';
import { PinoLogger } from 'nestjs-pino';

import { AppHttpException } from '#errors/app-http.exception.js';
import { ErrorCode } from '#errors/error.code.js';
import { ProblemDetailsFilter } from './problem-details.filter.js';

const REQUEST_ID = '550e8400-e29b-41d4-a716-446655440000';

// The catalog-consistency tests guarantee the real catalogs carry these
// English messages; the stub keeps this spec independent of the loader.
const ENGLISH_MESSAGES: Record<string, string> = {
  'errors.titles.applicationError': 'Application Error',
  'errors.titles.invalidRequestId': 'Invalid Request Id',
  'errors.titles.otpVerificationFailed': 'Verification Failed',
  'errors.titles.idempotencyKeyInUse': 'Idempotency Key In Use',
  'errors.titles.idempotencyRecordUnreadable': 'Idempotency Record Unreadable',
  'errors.status.notFound': 'Not Found',
  'errors.status.http': 'HTTP {status}',
  'errors.details.unexpected': 'An unexpected error occurred.',
  'errors.details.rateLimited': 'Too many requests. Retry later.',
  'errors.details.idempotencyKeyInUse':
    'A request with this Idempotency-Key is still being processed. Retry after the delay indicated by the Retry-After header.',
  'errors.details.idempotencyRecordUnreadable':
    'The stored result for this idempotency key could not be read. The key stays protected until it expires.',
};

function createFilterFixture(
  requestUrl = '/api/v1/hello',
  replyOverrides: { headersSent?: boolean; writableEnded?: boolean } = {},
) {
  const replySend = vi.fn();

  const reply: HttpResponseLike = {
    statusCode: 200,
    status: vi.fn<(code: number) => HttpResponseLike>(function this_(status: number) {
      reply.statusCode = status;
      return reply;
    }),
    header: vi.fn<(name: string, value: string) => HttpResponseLike>(() => reply),
    getHeader: vi.fn<(name: string) => undefined>(() => undefined),
    send: replySend,
    writableEnded: replyOverrides.writableEnded ?? false,
    headersSent: replyOverrides.headersSent ?? false,
  };

  const request: HttpRequestLike = { id: REQUEST_ID, url: requestUrl, headers: {} };

  const host = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => reply }),
  } as unknown as ArgumentsHost;

  const logger = { error: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;
  const i18n = {
    t: vi.fn(
      (key: string, options?: { args?: Record<string, unknown> }) =>
        ENGLISH_MESSAGES[key]?.replace(/\{(\w+)\}/g, (_, name: string) =>
          String(options?.args?.[name]),
        ) ?? key,
    ),
  } as unknown as I18nService;

  const i18nContext = { locale: 'en' } as unknown as I18nContext;

  return {
    filter: new ProblemDetailsFilter(logger, i18n, i18nContext),
    reply,
    replySend,
    logger,
    host,
    i18n,
    i18nContext,
  };
}

describe('ProblemDetailsFilter', () => {
  it('normalizes built-in HTTP exceptions into Problem Details', () => {
    const { filter, replySend, host } = createFilterFixture();

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
    const { filter, reply, host } = createFilterFixture();
    const headerSpy = reply.header as ReturnType<typeof vi.fn>;

    filter.catch(new NotFoundException(), host);

    expect(headerSpy).toHaveBeenCalledWith('content-type', 'application/problem+json');
    expect(headerSpy).toHaveBeenCalledWith('x-request-id', REQUEST_ID);
    expect(reply.status).toHaveBeenCalledWith(404);
  });

  it('joins validation message arrays into a readable detail', () => {
    const { filter, replySend, host } = createFilterFixture();

    filter.catch(new BadRequestException(['name must be a string', 'age must be a number']), host);

    expect(replySend).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 400,
        detail: 'name must be a string; age must be a number',
        code: ErrorCode.BadRequest,
      }),
    );
  });

  it('carries a replayed stored application error code through a plain HttpException (ADR-039)', () => {
    // Arrange — the package replays a stored error by re-throwing
    // HttpException(stored.body, status); the original AppHttpException body
    // carries the application's own code.
    const { filter, replySend, host } = createFilterFixture();
    const replayed = new HttpException(
      { code: ErrorCode.OtpVerificationFailed, detail: 'Phone number verification failed.' },
      HttpStatus.BAD_REQUEST,
    );

    // Act
    filter.catch(replayed, host);

    // Assert — the replay keeps the original execution's code, type, and
    // title instead of degrading to the status-based fallback.
    expect(replySend).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 400,
        code: ErrorCode.OtpVerificationFailed,
        type: '/problems/application-error',
        title: 'Verification Failed',
      }),
    );
  });

  it('maps the package idempotency rejections onto the localized contract', () => {
    // Arrange — the package throws plain HttpExceptions with its own code
    // string and an English-only message.
    const { filter, replySend, host } = createFilterFixture();
    const rejection = new HttpException(
      {
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        code: 'IDEMPOTENCY_KEY_IN_USE',
        message: 'A request with this idempotency key is still being processed.',
      },
      HttpStatus.CONFLICT,
    );

    // Act
    filter.catch(rejection, host);

    // Assert — the code string survives untranslated; the detail comes from
    // the catalog, never from the package's English message.
    expect(replySend).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 409,
        code: ErrorCode.IdempotencyKeyInUse,
        title: 'Idempotency Key In Use',
        detail: ENGLISH_MESSAGES['errors.details.idempotencyKeyInUse'],
      }),
    );
    expect(JSON.stringify(replySend.mock.calls[0][0])).not.toContain(
      'this idempotency key is still being processed',
    );
  });

  it('maps an unreadable idempotency record fail-closed with a localized detail', () => {
    // Arrange — the package's fail-closed 500 for a corrupt record.
    const { filter, replySend, host } = createFilterFixture();
    const unreadable = new HttpException(
      {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        error: 'Internal Server Error',
        code: 'IDEMPOTENCY_RECORD_UNREADABLE',
        message: 'The stored result for this idempotency key could not be read.',
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );

    // Act
    filter.catch(unreadable, host);

    // Assert — the localized detail replaces the package's English sentence.
    expect(replySend).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 500,
        code: ErrorCode.IdempotencyRecordUnreadable,
        title: 'Idempotency Record Unreadable',
        detail: ENGLISH_MESSAGES['errors.details.idempotencyRecordUnreadable'],
      }),
    );
  });

  it('normalizes AppHttpException with its typed code and family Problem Type', () => {
    const { filter, replySend, host } = createFilterFixture();

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
    const { filter, replySend, host } = createFilterFixture();

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
    const { filter, logger, host } = createFilterFixture();
    const original = new Error('boom');

    filter.catch(original, host);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: original }),
      'Unhandled exception',
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('keeps non-Error thrown values at error severity without echoing the value', () => {
    // A dependency rejecting with a non-Error is a genuine unhandled failure
    // and must stay visible at error level; the thrown value itself is never
    // logged or echoed (only its type is wrapped as the cause).
    const { filter, logger, replySend, host } = createFilterFixture();

    filter.catch('sensitive-throwable-value', host);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({ message: 'Non-Error value thrown (string)' }),
      }),
      'Unhandled exception',
    );
    expect(logger.warn).not.toHaveBeenCalled();
    const body = replySend.mock.calls[0][0] as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toContain('sensitive-throwable-value');
    expect(body).toEqual(
      expect.objectContaining({
        status: 500,
        code: ErrorCode.ApplicationError,
        detail: 'An unexpected error occurred.',
      }),
    );
  });

  it('logs expected client errors at warn severity only', () => {
    const { filter, logger, host } = createFilterFixture();

    filter.catch(new NotFoundException(), host);

    expect(logger.warn).toHaveBeenCalledWith('HTTP 404 NOT_FOUND');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs deliberate bare 5xx exceptions (e.g. load-shedding 503s) at warn severity', () => {
    // A bare ServiceUnavailableException carries no attached error — it is a
    // deliberate rejection, not an unhandled failure, so it must not pollute
    // error-level logs with an "Unhandled exception" line.
    const { filter, logger, host } = createFilterFixture();

    filter.catch(new ServiceUnavailableException('overloaded'), host);

    expect(logger.warn).toHaveBeenCalledWith('HTTP 503 SERVICE_UNAVAILABLE');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('never re-sends a response that is already committed, but still logs the failure', () => {
    // A response committed before the exception arrived (an @Sse() stream
    // erroring after its headers went out, or a raw reply that sent and then
    // threw) cannot carry Problem Details — a second send would throw
    // ERR_HTTP_HEADERS_SENT out of the filter and destroy the connection
    // (Wave 25 CR-02). The diagnostic logging must still run.
    const committedByHeaders = createFilterFixture('/api/v1/hello', { headersSent: true });
    committedByHeaders.filter.catch(new Error('late failure'), committedByHeaders.host);
    expect(committedByHeaders.replySend).not.toHaveBeenCalled();
    expect(committedByHeaders.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Unhandled exception (response already sent)',
    );

    const committedByEnd = createFilterFixture('/api/v1/hello', { writableEnded: true });
    committedByEnd.filter.catch(new NotFoundException(), committedByEnd.host);
    expect(committedByEnd.replySend).not.toHaveBeenCalled();
    expect(committedByEnd.logger.warn).toHaveBeenCalledWith(
      'HTTP 404 NOT_FOUND (response already sent)',
    );
  });

  it('falls back to the built-in message when a validation array has no string members', () => {
    // Wave 25 CR-04: an array response.message without string members must
    // not normalize to an empty detail; the built-in exception message is the
    // fallback every other non-representable shape gets.
    const { filter, replySend, host } = createFilterFixture();

    filter.catch(new BadRequestException({ message: [42, {}] }), host);

    // The built-in message of `BadRequestException({ message })` is "Bad
    // Request Exception" (the description default), never an empty string.
    expect(replySend).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 400,
        detail: 'Bad Request Exception',
        code: ErrorCode.BadRequest,
      }),
    );
  });

  it('derives the API version from the request URI on the error path', () => {
    const { filter, replySend, host } = createFilterFixture('/health');

    filter.catch(new NotFoundException(), host);

    expect(replySend).toHaveBeenCalledWith(expect.objectContaining({ apiVersion: 'neutral' }));
  });
});
