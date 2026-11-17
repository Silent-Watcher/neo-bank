import { StreamableFile } from '@nestjs/common';
import { HEADERS_METADATA } from '@nestjs/common/constants.js';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { I18nService } from '@nestjs/i18n';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor.js';

const REQUEST_ID = '550e8400-e29b-41d4-a716-446655440000';

interface Fixture {
  method?: string;
  url?: string;
  statusCode?: number;
  writableEnded?: boolean;
  headersSent?: boolean;
  contentType?: string;
}

function createInterceptorContext(
  fixture: Fixture = {},
  // No default for handleResult: a default would break the "does not wrap
  // undefined payloads" test case, which relies on an explicitly undefined
  // handler result.
  handleResult: unknown,
): { context: ExecutionContext; next: CallHandler; nextHandle: ReturnType<typeof vi.fn> } {
  const request = {
    method: fixture.method ?? 'GET',
    url: fixture.url ?? '/api/v1/hello',
    id: REQUEST_ID,
  };
  const reply = {
    statusCode: fixture.statusCode ?? 200,
    writableEnded: fixture.writableEnded ?? false,
    headersSent: fixture.headersSent ?? false,
    getHeader: vi.fn(() => fixture.contentType),
  };
  // A stable handler reference, so tests can attach Reflect metadata to it
  // before the interceptor reads it back through getHandler().
  const handler = function handler() {};
  const context = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => reply }),
    getHandler: () => handler,
  } as unknown as ExecutionContext;
  const nextHandle = vi.fn(() => of(handleResult));

  return { context, next: { handle: nextHandle }, nextHandle };
}

async function interceptOnce(context: ExecutionContext, next: CallHandler): Promise<unknown> {
  // Catalog-consistency tests guarantee the real 'common.success' message;
  // the stub keeps this spec independent of the loader.
  const i18n = { t: vi.fn(() => 'Success') } as unknown as I18nService;
  return new Promise((resolve) => {
    new ResponseEnvelopeInterceptor(i18n).intercept(context, next).subscribe(resolve);
  });
}

describe('ResponseEnvelopeInterceptor', () => {
  it('wraps an ordinary successful JSON response exactly once', async () => {
    const { context, next } = createInterceptorContext({}, { example: true });

    const result = (await interceptOnce(context, next)) as Record<string, unknown>;

    expect(result).toEqual({
      timestamp: expect.any(String),
      apiVersion: 'v1',
      requestId: REQUEST_ID,
      status: 200,
      message: 'Success',
      data: { example: true },
    });
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('uses the actual response status code, not a hard-coded value', async () => {
    const { context, next } = createInterceptorContext({ statusCode: 201 }, { example: true });

    const result = (await interceptOnce(context, next)) as { status: number };

    expect(result.status).toBe(201);
  });

  it('resolves the api version from the request URI', async () => {
    const { context, next } = createInterceptorContext({ url: '/health' }, { example: true });

    const result = (await interceptOnce(context, next)) as { apiVersion: string };

    expect(result.apiVersion).toBe('neutral');
  });

  it('does not wrap HEAD responses', async () => {
    const { context, next, nextHandle } = createInterceptorContext(
      { method: 'HEAD' },
      { example: true },
    );

    const result = await interceptOnce(context, next);

    expect(nextHandle).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ example: true });
  });

  it('does not wrap 204 No Content responses', async () => {
    const { context, next } = createInterceptorContext({ statusCode: 204 }, { example: true });

    const result = await interceptOnce(context, next);

    expect(result).toEqual({ example: true });
  });

  it('does not wrap 304 Not Modified responses', async () => {
    const { context, next } = createInterceptorContext({ statusCode: 304 }, { example: true });

    const result = await interceptOnce(context, next);

    expect(result).toEqual({ example: true });
  });

  it('does not wrap responses whose reply is already sent (raw reply usage)', async () => {
    const { context, next } = createInterceptorContext({ writableEnded: true }, { example: true });

    const result = await interceptOnce(context, next);

    expect(result).toEqual({ example: true });
  });

  it('does not wrap responses whose reply already started sending (raw streaming usage)', async () => {
    const { context, next } = createInterceptorContext({ headersSent: true }, { example: true });

    const result = await interceptOnce(context, next);

    expect(result).toEqual({ example: true });
  });

  it('does not wrap StreamableFile payloads', async () => {
    const { context, next } = createInterceptorContext({}, new StreamableFile(Buffer.from('file')));

    const result = await interceptOnce(context, next);

    expect(result).toBeInstanceOf(StreamableFile);
  });

  it('does not wrap undefined payloads', async () => {
    const { context, next } = createInterceptorContext({}, undefined);

    const result = await interceptOnce(context, next);

    expect(result).toBeUndefined();
  });

  it('does not wrap routes that set their own non-JSON content type', async () => {
    const { context, next } = createInterceptorContext(
      {
        contentType: 'text/html; charset=utf-8',
      },
      { example: true },
    );

    const result = await interceptOnce(context, next);

    expect(result).toEqual({ example: true });
  });

  it('does not wrap routes that declare a non-JSON content type via @Header', async () => {
    // Arrange — the router applies @Header values after interceptors run, so
    // the interceptor can only see them on the handler's metadata.
    const { context, next } = createInterceptorContext({}, { example: true });
    Reflect.defineMetadata(
      HEADERS_METADATA,
      [{ name: 'Content-Type', value: 'text/plain' }],
      context.getHandler(),
    );

    // Act
    const result = await interceptOnce(context, next);

    // Assert
    expect(result).toEqual({ example: true });
  });

  it('does not wrap a response that becomes 304 mid-pipeline', async () => {
    // Arrange — the conditional-request interceptor runs inside this one and
    // may set 304 between the eager skip (which saw 200) and the map; the
    // map-time check must still bypass the wrap (Wave 25 follow-up, ADR-038
    // §5). The statusCode stub reports 200 for the eager check and 304 after.
    let statusCodeReads = 0;
    const reply = {
      writableEnded: false,
      headersSent: false,
      getHeader: vi.fn(() => undefined),
      get statusCode() {
        statusCodeReads += 1;
        return statusCodeReads === 1 ? 200 : 304;
      },
    };
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'GET', url: '/api/v1/hello', id: REQUEST_ID }),
        getResponse: () => reply,
      }),
      getHandler: () => function handler() {},
    } as unknown as ExecutionContext;
    const next: CallHandler = { handle: () => of({ example: true }) };

    // Act
    const result = await interceptOnce(context, next);

    // Assert
    expect(result).toEqual({ example: true });
  });

  it('does not wrap a payload whose handler set a non-JSON content type mid-execution', async () => {
    // Arrange — the eager skip runs before the handler and cannot see a
    // content type the handler sets during execution; the map-time re-check
    // must catch it (Wave 25 CR-01). The mock returns undefined for the eager
    // call and the non-JSON type from the map call on.
    let getHeaderCalls = 0;
    const reply = {
      statusCode: 200,
      writableEnded: false,
      headersSent: false,
      getHeader: vi.fn(() => {
        getHeaderCalls += 1;
        return getHeaderCalls === 1 ? undefined : 'text/html; charset=utf-8';
      }),
    };
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'GET', url: '/api/v1/hello', id: REQUEST_ID }),
        getResponse: () => reply,
      }),
      getHandler: () => function handler() {},
    } as unknown as ExecutionContext;
    const next: CallHandler = { handle: () => of({ example: true }) };

    // Act
    const result = await interceptOnce(context, next);

    // Assert
    expect(result).toEqual({ example: true });
  });

  it('does not wrap binary-view payloads (raw Buffer bodies)', async () => {
    // Arrange — the adapter sends ArrayBuffer views as binary; wrapping would
    // mangle them into a {"type":"Buffer"} JSON body (Wave 25 CR-05).
    const payload = Buffer.from('binary-bytes');
    const { context, next } = createInterceptorContext({}, payload);

    // Act
    const result = await interceptOnce(context, next);

    // Assert
    expect(result).toBe(payload);
  });

  it('still wraps routes that declare a JSON content type via @Header', async () => {
    // Arrange
    const { context, next } = createInterceptorContext({}, { example: true });
    Reflect.defineMetadata(
      HEADERS_METADATA,
      [{ name: 'Content-Type', value: 'application/json; charset=utf-8' }],
      context.getHandler(),
    );

    // Act
    const result = (await interceptOnce(context, next)) as Record<string, unknown>;

    // Assert
    expect(result.message).toBe('Success');
    expect(result.data).toEqual({ example: true });
  });
});
