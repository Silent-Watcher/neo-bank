import { describe, expect, it } from 'vitest';

import { buildPinoHttpOptions } from './pino-http.options.js';

describe('buildPinoHttpOptions', () => {
  it('uses the configured level', () => {
    const options = buildPinoHttpOptions({ level: 'debug', pretty: false });

    expect(options.level).toBe('debug');
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
