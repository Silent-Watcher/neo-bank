import { StreamableFile } from '@nestjs/common';
import { HEADERS_METADATA, SSE_METADATA } from '@nestjs/common/constants.js';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { I18nContext } from '@nestjs/i18n';
import { of } from 'rxjs';
import type { Observable } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { weakEtagFor } from './etag.js';
import { ConditionalRequestInterceptor } from './conditional-request.interceptor.js';

interface Fixture {
  method?: string;
  ifNoneMatch?: string;
  statusCode?: number;
  writableEnded?: boolean;
  headersSent?: boolean;
  locale?: string;
  sseHandler?: boolean;
  contentType?: string;
  cacheControl?: string;
}

function createInterceptorContext(
  fixture: Fixture = {},
  handleResult: unknown,
): {
  context: ExecutionContext;
  next: CallHandler;
  reply: Record<string, ReturnType<typeof vi.fn> | unknown>;
} {
  const request = {
    method: fixture.method ?? 'GET',
    url: '/api/v1/hello',
    headers: {
      'if-none-match': fixture.ifNoneMatch,
    },
  };
  // The chained express-style helpers record their calls; `header`/`status`
  // return the reply itself, like the adapter's facade does.
  const reply: Record<string, unknown> = {
    statusCode: fixture.statusCode ?? 200,
    writableEnded: fixture.writableEnded ?? false,
    headersSent: fixture.headersSent ?? false,
  };
  reply.getHeader = vi.fn<(name: string) => string | undefined>((name: string) => {
    if (name.toLowerCase() === 'content-type') return fixture.contentType;
    if (name.toLowerCase() === 'cache-control') return fixture.cacheControl;
    return undefined;
  });
  reply.header = vi.fn<(name: string, value: string) => unknown>(function header(
    name: string,
    value: string,
  ) {
    void name;
    void value;
    return reply;
  });
  reply.status = vi.fn<(code: number) => unknown>(function status(code: number) {
    void code;
    return reply;
  });
  // A stable handler reference so tests can attach Reflect metadata to it
  // before the interceptor reads it back through getHandler().
  const handler = function handler() {};
  if (fixture.sseHandler === true) {
    Reflect.defineMetadata(SSE_METADATA, true, handler);
  }
  const context = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => reply }),
    getHandler: () => handler,
  } as unknown as ExecutionContext;
  const next: CallHandler = { handle: vi.fn<() => Observable<unknown>>(() => of(handleResult)) };

  return { context, next, reply };
}

async function interceptOnce(
  context: ExecutionContext,
  next: CallHandler,
  locale = 'en',
): Promise<unknown> {
  // The per-request locale is read from the i18n AsyncLocalStorage through
  // I18nContext's `locale` getter; the stub fixes one locale for the request.
  const i18nContext = { locale } as unknown as I18nContext;
  return new Promise((resolve) => {
    new ConditionalRequestInterceptor(i18nContext).intercept(context, next).subscribe(resolve);
  });
}

describe('ConditionalRequestInterceptor', () => {
  it('tags a JSON-serializable payload with a locale-composed weak entity tag', async () => {
    const { context, next, reply } = createInterceptorContext({}, { example: true });

    await interceptOnce(context, next, 'en');

    expect(reply.header).toHaveBeenCalledWith(
      'ETag',
      weakEtagFor(JSON.stringify({ example: true }), 'en'),
    );
  });

  it('sets the revalidation cache directives on tagged responses', async () => {
    const { context, next, reply } = createInterceptorContext({}, { example: true });

    await interceptOnce(context, next, 'en');

    expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'private, no-cache');
  });

  it('never overwrites an explicitly declared Cache-Control header', async () => {
    // A route that controls its own caching policy (e.g. the health routes'
    // no-store) wins over the interceptor's revalidation directives
    // (Wave 25/26 SEC-04).
    const { context, next, reply } = createInterceptorContext(
      { cacheControl: 'no-store' },
      { example: true },
    );

    await interceptOnce(context, next, 'en');

    expect(reply.header).toHaveBeenCalledWith('ETag', expect.any(String));
    expect(reply.header).not.toHaveBeenCalledWith('Cache-Control', expect.anything());
  });

  it('emits distinct validators for distinct locales', async () => {
    const en = createInterceptorContext({}, { example: true });
    const fa = createInterceptorContext({}, { example: true });

    await interceptOnce(en.context, en.next, 'en');
    await interceptOnce(fa.context, fa.next, 'fa');

    expect(en.reply.header).toHaveBeenCalledWith(
      'ETag',
      weakEtagFor(JSON.stringify({ example: true }), 'en'),
    );
    expect(fa.reply.header).toHaveBeenCalledWith(
      'ETag',
      weakEtagFor(JSON.stringify({ example: true }), 'fa'),
    );
  });

  it('answers a matching If-None-Match on a successful GET with a serialization-free 304', async () => {
    const etag = weakEtagFor(JSON.stringify({ example: true }), 'en');
    const { context, next, reply } = createInterceptorContext(
      { ifNoneMatch: etag },
      { example: true },
    );

    const result = await interceptOnce(context, next, 'en');

    expect(reply.status).toHaveBeenCalledWith(304);
    // ADR-038 §5: nothing is serialized after the 304 decision — the payload
    // is dropped in the map, so the pipeline cannot emit a response body.
    expect(result).toBeUndefined();
  });

  it('keeps the full response when the candidate does not match', async () => {
    const { context, next, reply } = createInterceptorContext(
      { ifNoneMatch: 'W/"different"' },
      { example: true },
    );

    const result = await interceptOnce(context, next);

    expect(reply.status).not.toHaveBeenCalled();
    expect(result).toEqual({ example: true });
  });

  it('never revalidates an error-status response to 304', async () => {
    const payload = { failed: true };
    const etag = weakEtagFor(JSON.stringify(payload), 'en');
    const { context, next, reply } = createInterceptorContext(
      { statusCode: 400, ifNoneMatch: etag },
      payload,
    );

    const result = await interceptOnce(context, next, 'en');

    expect(reply.header).toHaveBeenCalledWith('ETag', etag);
    expect(reply.status).not.toHaveBeenCalled();
    expect(result).toEqual(payload);
  });

  it('never revalidates methods other than GET and HEAD', async () => {
    const etag = weakEtagFor(JSON.stringify({ created: true }), 'en');
    const { context, next, reply } = createInterceptorContext(
      { method: 'POST', ifNoneMatch: etag },
      { created: true },
    );

    await interceptOnce(context, next, 'en');

    expect(reply.status).not.toHaveBeenCalled();
  });

  it('revalidates HEAD with the same validator as GET', async () => {
    const etag = weakEtagFor(JSON.stringify({ example: true }), 'en');
    const { context, next, reply } = createInterceptorContext(
      { method: 'HEAD', ifNoneMatch: etag },
      { example: true },
    );

    const result = await interceptOnce(context, next, 'en');

    expect(reply.status).toHaveBeenCalledWith(304);
    expect(result).toBeUndefined();
  });

  it('tags primitive payloads too', async () => {
    const { context, next, reply } = createInterceptorContext({}, 'plain-payload');

    await interceptOnce(context, next);

    expect(reply.header).toHaveBeenCalledWith(
      'ETag',
      weakEtagFor(JSON.stringify('plain-payload'), 'en'),
    );
  });

  it('does not tag payloads with no JSON representation', async () => {
    const { context, next, reply } = createInterceptorContext({}, function unserializable() {});

    await interceptOnce(context, next);

    expect(reply.header).not.toHaveBeenCalled();
    expect(reply.status).not.toHaveBeenCalled();
  });

  it('does not tag SSE handlers', async () => {
    const { context, next, reply } = createInterceptorContext(
      { sseHandler: true },
      { event: true },
    );

    await interceptOnce(context, next);

    expect(reply.header).not.toHaveBeenCalled();
  });

  it('does not tag StreamableFile payloads', async () => {
    const { context, next, reply } = createInterceptorContext(
      {},
      new StreamableFile(Buffer.from('file')),
    );

    await interceptOnce(context, next);

    expect(reply.header).not.toHaveBeenCalled();
  });

  it('does not tag binary-view payloads (raw Buffer bodies)', async () => {
    // Arrange — the adapter sends ArrayBuffer views as binary; the wire body
    // is not a JSON representation (Wave 25 CR-05).
    const { context, next, reply } = createInterceptorContext({}, Buffer.from('binary-bytes'));

    // Act
    await interceptOnce(context, next);

    // Assert
    expect(reply.header).not.toHaveBeenCalled();
  });

  it('does not tag a response whose reply already ended', async () => {
    const { context, next, reply } = createInterceptorContext(
      { writableEnded: true },
      { example: true },
    );

    await interceptOnce(context, next);

    expect(reply.header).not.toHaveBeenCalled();
  });

  it('does not tag a response whose headers were already sent', async () => {
    const { context, next, reply } = createInterceptorContext(
      { headersSent: true },
      { example: true },
    );

    await interceptOnce(context, next);

    expect(reply.header).not.toHaveBeenCalled();
  });

  it('does not tag routes that declare a non-JSON content type via @Header', async () => {
    // Arrange — the router applies @Header values after interceptors run, so
    // the interceptor can only see them on the handler's metadata; a text
    // body is not the JSON representation the tag would validate.
    const { context, next, reply } = createInterceptorContext({}, { example: true });
    Reflect.defineMetadata(
      HEADERS_METADATA,
      [{ name: 'Content-Type', value: 'text/plain' }],
      context.getHandler(),
    );

    // Act
    await interceptOnce(context, next);

    // Assert
    expect(reply.header).not.toHaveBeenCalled();
  });

  it('does not tag routes that set a non-JSON content type on the reply', async () => {
    // Arrange — raw reply usage controls its own representation.
    const { context, next, reply } = createInterceptorContext(
      { contentType: 'text/html; charset=utf-8' },
      { example: true },
    );

    // Act
    await interceptOnce(context, next);

    // Assert
    expect(reply.header).not.toHaveBeenCalled();
  });
});
