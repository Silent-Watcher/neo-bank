import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Options } from 'pino-http';

import type { LogConfig } from '#config/log.config.js';

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
    // pino-http only binds the request ID to child loggers, so access-log
    // lines carry it solely inside `req`; lift it to the top level to keep
    // records queryable by the shared request ID directly.
    // Parameter types match the declared pino-http callback signature; the
    // explicit annotations keep req.id typed through IncomingMessage
    // augmentation instead of relying on contextual any.
    customSuccessObject: (req: IncomingMessage, _res: ServerResponse, object: object) => ({
      reqId: req.id,
      ...object,
    }),
    customErrorObject: (
      req: IncomingMessage,
      _res: ServerResponse,
      _error: Error,
      object: object,
    ) => ({
      reqId: req.id,
      ...object,
    }),
  };

  if (config.pretty) {
    options.transport = { target: 'pino-pretty' };
  }

  return options;
}
