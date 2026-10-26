import type { Options } from 'pino-http';

import type { LogConfig } from '../config/log.config.js';

// Central Pino/pino-http options: JSON by default, pino-pretty only where the
// configuration enables it (development). Sensitive headers are redacted at
// the logger level; request and response bodies are not logged.
export function buildPinoHttpOptions(config: LogConfig): Options {
  const options: Options = {
    level: config.level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        'req.headers["x-auth-token"]',
        'res.headers["set-cookie"]',
      ],
      censor: '[Redacted]',
    },
  };

  if (config.pretty) {
    options.transport = { target: 'pino-pretty' };
  }

  return options;
}
