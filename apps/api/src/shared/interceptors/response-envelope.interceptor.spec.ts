import { StreamableFile } from '@nestjs/common';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor.js';

const REQUEST_ID = '550e8400-e29b-41d4-a716-446655440000';

interface Fixture {
  method?: string;
  url?: string;
  statusCode?: number;
  sent?: boolean;
  contentType?: string;
  handlerMetadata?: Record<string, unknown>;
}

function createInterceptorContext(
  fixture: Fixture = {},
  // handleResult: unknown = { example: true },
  // when we specify default value like {example:true} it breaks the "does not wrap undefined payloads" test case
  handleResult: unknown,
): { context: ExecutionContext; next: CallHandler; nextHandle: ReturnType<typeof vi.fn> } {
  const request = {
    method: fixture.method ?? 'GET',
    url: fixture.url ?? '/api/v1/hello',
    id: REQUEST_ID,
  };
  const reply = {
    statusCode: fixture.statusCode ?? 200,
    sent: fixture.sent ?? false,
    getHeader: vi.fn(() => fixture.contentType),
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => reply }),
    getHandler: () => Object.assign(function handler() {}, fixture.handlerMetadata),
  } as unknown as ExecutionContext;
  const nextHandle = vi.fn(() => of(handleResult));

  return { context, next: { handle: nextHandle }, nextHandle };
}

async function interceptOnce(context: ExecutionContext, next: CallHandler): Promise<unknown> {
  return new Promise((resolve) => {
    new ResponseEnvelopeInterceptor().intercept(context, next).subscribe(resolve);
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
    const { context, next } = createInterceptorContext({ sent: true }, { example: true });

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
});
