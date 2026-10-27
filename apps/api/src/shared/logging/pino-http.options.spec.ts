import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

import { describe, expect, it } from 'vitest';

import { buildPinoHttpOptions } from './pino-http.options.js';

describe('buildPinoHttpOptions', () => {
  it('uses the configured level', () => {
    const options = buildPinoHttpOptions({ level: 'debug', pretty: false });

    expect(options.level).toBe('debug');
  });

  it('lifts the request ID to the top level of access-log lines', () => {
    // Arrange
    const options = buildPinoHttpOptions({ level: 'info', pretty: false });
    const { customSuccessObject, customErrorObject } = options;
    if (customSuccessObject === undefined || customErrorObject === undefined) {
      throw new Error('access-log object providers must be configured');
    }
    const requestId = '0d7cc8b7-6e82-4ec1-a5a2-2a3f4b5c6d7e';
    const request = new IncomingMessage(new Socket());
    request.id = requestId;
    const response = new ServerResponse(request);
    const successObject = { res: { statusCode: 200 } };
    const errorObject = { err: { message: 'failed with status code 500' } };

    // Act
    const success = customSuccessObject(request, response, successObject);
    const error = customErrorObject(request, response, new Error('boom'), errorObject);

    // Assert
    expect(success).toEqual({ reqId: requestId, res: { statusCode: 200 } });
    expect(error).toEqual({ reqId: requestId, err: { message: 'failed with status code 500' } });
  });

  it('redacts sensitive request and response headers', () => {
    const options = buildPinoHttpOptions({ level: 'info', pretty: false });

    expect(options.redact).toBeDefined();
    if (Array.isArray(options.redact)) {
      expect.fail('redaction must use the options form, not a plain path list');
    }
    expect(options.redact?.paths).toEqual([
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-api-key"]',
      'req.headers["x-auth-token"]',
      'res.headers["set-cookie"]',
    ]);
    expect(options.redact?.censor).toBe('[Redacted]');
  });

  it('enables the pino-pretty transport only where configured', () => {
    const pretty = buildPinoHttpOptions({ level: 'info', pretty: true });
    const plain = buildPinoHttpOptions({ level: 'info', pretty: false });

    expect(pretty.transport).toEqual({ target: 'pino-pretty' });
    expect(plain.transport).toBeUndefined();
  });
});
