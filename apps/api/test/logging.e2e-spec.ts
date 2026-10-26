import { Writable } from 'node:stream';

import { VersioningType } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Logger, PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';
import serverConfig from '../src/shared/config/server.config.js';
import { fastifyGenReqId } from '../src/shared/http/request-id.js';

interface LogLine {
  [key: string]: unknown;
}

// Exercises the real AppModule logging pipeline but redirects Pino's output
// into an in-memory sink instead of stdout, so log records can be asserted.
describe('Pino logging (e2e)', () => {
  let app: NestFastifyApplication;
  let lines: string[];

  beforeAll(async () => {
    const { trustProxy, bodyLimit } = serverConfig();

    lines = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
        lines.push(chunk.toString());
        callback();
      },
    });

    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PARAMS_PROVIDER_TOKEN)
      .useValue({ pinoHttp: { level: 'info', stream: sink } })
      .compile();

    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ trustProxy, bodyLimit, genReqId: fastifyGenReqId }),
    );
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useLogger(app.get(Logger));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  function parsedLines(): LogLine[] {
    return lines
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as LogLine);
  }

  it('replaces the NestJS system logger with the Pino-backed Logger', () => {
    // Assert
    expect(app.get(Logger)).toBeInstanceOf(Logger);
  });

  it('emits structured JSON logs in the test environment', () => {
    // Assert
    const parsed = parsedLines();

    expect(parsed.length).toBeGreaterThan(0);
    for (const line of parsed) {
      expect(line.level).toEqual(expect.any(Number));
      expect(line.time).toEqual(expect.any(Number));
    }
  });

  it('keeps framework startup logs on the same Pino pipeline', () => {
    // Assert
    const parsed = parsedLines();
    const startup = parsed.find((line) => typeof line.context === 'string');

    expect(startup).toBeDefined();
  });

  it('produces exactly one access-log line per request with the shared request ID', async () => {
    // Arrange
    const before = parsedLines().length;

    // Act
    const response = await request(app.getHttpServer()).get('/api/v1/echo');

    // Assert
    const accessLogs = parsedLines()
      .slice(before)
      .filter((line) => line.req !== undefined && line.res !== undefined);

    expect(accessLogs).toHaveLength(1);
    expect((accessLogs[0].reqId as number | string).toString()).toBe(
      response.headers['x-request-id'],
    );
    expect((accessLogs[0].req as { method: string }).method).toBe('GET');
  });

  it('redacts sensitive headers from access logs', async () => {
    // Act
    await request(app.getHttpServer())
      .get('/api/v1/echo')
      .set('authorization', 'Bearer super-secret-token');

    // Assert
    const accessLog = parsedLines().find(
      (line) =>
        line.req !== undefined &&
        (line.req as { headers?: Record<string, unknown> }).headers?.authorization !== undefined,
    );

    expect(accessLog).toBeDefined();
    expect((accessLog?.req as { headers: Record<string, unknown> }).headers.authorization).toBe(
      '[Redacted]',
    );
  });

  it('logs unhandled server errors once, with the original exception', async () => {
    // Arrange
    const before = parsedLines().filter((line) => line.err !== undefined).length;

    // Act
    await request(app.getHttpServer()).get('/api/v1/boom');

    // Assert
    const errorLogs = parsedLines()
      .slice(before)
      .filter((line) => line.err !== undefined && line.level === 50);

    expect(errorLogs).toHaveLength(1);
    expect(errorLogs[0].msg as string).toBe('Unhandled exception');
    expect((errorLogs[0].err as { message?: string }).message).toContain('postgres://secret');
  });
});
