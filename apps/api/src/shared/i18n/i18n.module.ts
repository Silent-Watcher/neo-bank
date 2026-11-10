import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { AcceptLanguageLocaleResolver, I18nModule, JsonI18nLoader } from '@nestjs/i18n';
import type { I18nModuleOptions } from '@nestjs/i18n';

import { SERVER_CONFIG } from '#config/server.config.js';
import type { ServerConfig } from '#config/server.config.js';
import { AppEnv } from '#enums/app-env.enum.js';

// The application's locales (ADR-021). Pinned explicitly so a stray catalog
// directory can never widen the set of locales a request can receive.
export const DEFAULT_LOCALE = 'en';
export const SUPPORTED_LOCALES = ['en', 'fa'] as const;

// Catalog location: `src/i18n/` in development/test (Vitest runs from src)
// and `dist/i18n/` in production (nest-cli.json copies the JSON assets into
// dist). This file sits two directories below either root, so the relative
// path is identical in both runtimes.
const CATALOG_PATH = join(import.meta.dirname, '..', '..', 'i18n');

const i18nModule = I18nModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (configService: ConfigService): I18nModuleOptions => {
    const { env } = configService.getOrThrow<ServerConfig>(SERVER_CONFIG);

    return {
      defaultLocale: DEFAULT_LOCALE,
      supportedLocales: [...SUPPORTED_LOCALES],
      // Development/test fail loudly on a missing translation key
      // (I18nMissingKeyError); production falls back to English and warns.
      missingKey: env === AppEnv.Production ? 'fallback' : 'throw',
      loader: new JsonI18nLoader({
        path: CATALOG_PATH,
        // Catalog hot reload is a development convenience only; production
        // never watches translation files.
        watch: env === AppEnv.Development,
      }),

      // ── Locale resolution (ADR-021) ────────────────────────────────────────
      // Resolvers run in array order; the first candidate that matches a
      // supported locale wins. `AcceptLanguageLocaleResolver` is the only
      // active resolver: it parses `Accept-Language` (with q-values), skips
      // unsupported languages, falls back to the base language for regional
      // identifiers (fa-IR → fa, en-US → en), and yields to
      // `defaultLocale` when the header is missing or matches nothing.
      //
      // To add another resolver later:
      //   1. Import it from '@nestjs/i18n' — QueryLocaleResolver,
      //      HeaderLocaleResolver, CookieLocaleResolver — or extend
      //      `LocaleResolver` with a custom `resolve()` implementation.
      //   2. Prepend (or append) it here, e.g.
      //      `new QueryLocaleResolver('lang')` for `?lang=fa`,
      //      `new HeaderLocaleResolver('x-lang')` for a custom header.
      //   3. Its position decides precedence over Accept-Language: earlier
      //      in the array wins.
      //   4. It must return a locale candidate; the module only accepts
      //      candidates matching `supportedLocales` (or `fallbacks` keys).
      //   5. Add tests: resolution precedence over Accept-Language in
      //      test/i18n.e2e-spec.ts, and `Vary` coverage for any new request
      //      headers the resolver reads (resolvers declare their own
      //      `varyHeaders`, which the module merges into the response).
      resolvers: [new AcceptLanguageLocaleResolver()],
      // Sets Content-Language and Vary on every response (ADR-021).
      responseHeaders: true,
    };
  },
});

export { i18nModule };
