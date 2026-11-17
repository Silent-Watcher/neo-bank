import { z } from 'zod';

import { AppEnv } from '#enums/app-env.enum.js';
import { optionalHttpUrlEnv, positiveSafeInteger } from './validation-helpers.js';

function isOrigin(value: string): boolean {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}

export function parseCorsOrigins(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;

  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return origins.length > 0 ? origins : undefined;
}

export function isCorsOriginRequiredInProduction(env: {
  APP_ENV: AppEnv;
  CORS_ORIGIN?: string[] | undefined;
}): boolean {
  return env.APP_ENV === AppEnv.Production && env.CORS_ORIGIN === undefined;
}

export const serverEnvSchema = z.object({
  // Required (no default, fail-closed): an omitted APP_ENV must fail startup
  // rather than silently booting a development-gated process in an intended
  // production deployment — the development gate is what keeps the Swagger
  // surface and pino-pretty off production (Wave 26 SEC-01).
  APP_ENV: z.enum(AppEnv),
  HOST: z
    .union([z.ipv4(), z.ipv6(), z.hostname()])
    .describe('Server bind address: a hostname, IPv4, or IPv6 address.'),
  PORT: z.coerce
    .number({ error: 'PORT must be a valid number.' })
    .int('PORT must be an integer.')
    .min(1, 'PORT must be between 1 and 65535.')
    .max(65535, 'PORT must be between 1 and 65535.'),
  // Parsed into an explicit allow-list so that missing or fully empty
  // configuration disables CORS instead of allowing every origin, and each
  // entry must already be an exact origin so no URL normalization can widen it.
  CORS_ORIGIN: z
    .string()
    .optional()
    .transform(parseCorsOrigins)
    .refine((origins) => origins === undefined || origins.every(isOrigin), {
      message: 'CORS_ORIGIN entries must be origins (scheme://host[:port]) without a path.',
    }),
  // Only the exact strings "true" and "false" are accepted so that no other
  // string is coerced into a truthy value by accident.
  TRUST_PROXY: z
    .enum(['true', 'false'], { error: 'TRUST_PROXY must be exactly "true" or "false".' })
    .default('false')
    .transform((value) => value === 'true'),
  // Optional proxy allowlist used only when TRUST_PROXY=true: comma-separated
  // proxy addresses or CIDR ranges (for example "10.0.0.0/8,192.168.1.10")
  // whose X-Forwarded-* headers are trusted instead of every hop. Only
  // meaningful together with TRUST_PROXY=true; when unset with TRUST_PROXY=true
  // every hop is trusted, which requires an X-Forwarded-For-sanitizing proxy.
  // Entries are sanity-checked here (no whitespace or separators); semantic
  // errors in an entry fail fast at adapter construction (proxy-addr compile).
  TRUST_PROXY_PROXIES: z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value.trim() === '') return undefined;
      return value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    })
    .refine(
      (proxies) =>
        proxies === undefined || proxies.every((entry) => /^[a-zA-Z0-9.:/-]+$/.test(entry)),
      {
        message:
          'TRUST_PROXY_PROXIES entries must be proxy addresses or CIDR ranges without whitespace.',
      },
    ),
  // Request body size in bytes. Constrains payload size to bound memory
  // consumption per request and limit the impact of oversized-payload abuse.
  BODY_LIMIT: positiveSafeInteger('BODY_LIMIT').default(1048576),
  // Host-accessible Redis Insight URL (ADR-020). Optional and set only where
  // Redis Insight is actually exposed (the development Compose stack): the
  // startup log prints the URL only when this is configured, so environments
  // without Insight never advertise an address that does not exist.
  REDIS_INSIGHT_URL: optionalHttpUrlEnv('REDIS_INSIGHT_URL'),
  // MockServer addresses (ADR-024). Optional and set only by the development
  // Compose stack: the host URL for developers on the machine, the Docker URL
  // for containers on the Compose network. The startup log prints each
  // address only when configured, so environments without MockServer never
  // advertise an address that does not exist.
  MOCKSERVER_HOST_URL: optionalHttpUrlEnv('MOCKSERVER_HOST_URL'),
  MOCKSERVER_DOCKER_URL: optionalHttpUrlEnv('MOCKSERVER_DOCKER_URL'),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
