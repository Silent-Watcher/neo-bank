import { z } from 'zod';

import { AppEnv } from '../../../enums/app-env.enum.js';

export const serverEnvSchema = z.object({
  APP_ENV: z.enum(AppEnv).default(AppEnv.Development),
  HOST: z
    .union([z.ipv4(), z.ipv6(), z.hostname()])
    .describe('Server bind address: a hostname, IPv4, or IPv6 address.'),
  PORT: z.coerce
    .number({ error: 'PORT must be a valid number.' })
    .int('PORT must be an integer.')
    .min(1, 'PORT must be between 1 and 65535.')
    .max(65535, 'PORT must be between 1 and 65535.'),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
