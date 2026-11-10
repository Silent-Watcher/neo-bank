# _030 — Internationalization (en/fa) for the NestJS API

## Original user request

Introduce English and Persian internationalization into the API (`apps/api`)
on a production-ready, extensible, type-safe foundation:

- Locales `en` (default) and `fa`; resolved per request via
  `Accept-Language` only (`AcceptLanguageLocaleResolver`), with `q`-values,
  regional identifiers (`fa-IR` → `fa`), missing/unsupported → default.
- Translation catalogs organized by namespace, English as the key source of
  truth, type-safe keys, catalogs available in the production runtime.
- Integration with the existing custom `ZodValidationPipe`, exception layer
  (`AppHttpException` + Problem Details filter), and response envelope
  interceptor — by adaptation, not replacement; contracts unchanged.
- Missing-key policy: `throw` in development/test, `fallback` (to English)
  in production.
- Persian: natural formal Persian, `Intl.PluralRules` categories, no
  translation of identifiers/codes/machine values, genuine ambiguities asked
  of the user.
- Permanent bilingual development rule added to the AGENTS.md hierarchy.
- ADR-first workflow; no commits without explicit approval.

The user approved the proposal (including the official `@nestjs/i18n`
package over the community `nestjs-i18n`) and ADR-021, answered the Persian
terminology questions (رمز یک‌بار مصرف / شماره تلفن همراه / با موفقیت انجام
شد), and requested تداخل instead of تضاد for "conflict".

## Implementation record

- **ADR-021** written to `DECISIONS.md` as the first repository write
  (Accepted), documenting the library choice, locale strategy, catalog
  architecture, integration approach, and trade-offs.
- **Dependency:** `@nestjs/i18n@0.0.3` (official NestJS org package; peers
  `@nestjs/common|core ^12.1.0`, `@standard-schema/spec`; zero runtime
  dependencies). Verified against the installed package's actual API
  (options interface, resolvers, `i18nIssueMessage`,
  `translateStandardSchemaIssues`, loader, middleware) before writing code.
- **Catalogs:** `apps/api/src/i18n/{en,fa}/{common,errors,health,otp,
  validation}.json`; `src/i18n/i18n.types.ts` registers the English shape
  with `I18nTypes` so every key is compile-time checked.
- **Registration:** `src/shared/i18n/i18n.module.ts` — `I18nModule.
  forRootAsync` reading `APP_ENV` via `ConfigService`; pinned
  `supportedLocales`, `missingKey` (`throw` dev/test, `fallback` prod),
  `JsonI18nLoader` with `watch` in development only, resolver list with the
  mandatory "how to add a resolver" comment block, `responseHeaders: true`.
- **Zod integration:** `ZodValidationPipe` keeps its structure
  (`BadRequestException(string[])` → filter join) and translates issues via
  `translateStandardSchemaIssues`; schemas reference keys with
  `i18nIssueMessage()`; whole-input `invalid_type` issues (no path, skipped
  by the library by design) are translated explicitly so Persian responses
  never leak English Zod messages.
- **Exceptions:** services throw `AppHttpException(code, i18n.t(key), status)`;
  the filter translates the Problem Details `title` (per code/status key
  maps) and its two generic fallback details; `code`/`status`/`type` stay
  machine-readable. The pre-i18n Fastify request-ID rejection stays English,
  documented in place.
- **Envelope:** only `message` is localized (`common.success`); bypass
  behavior untouched.
- **Health:** Redis indicator fallback string localized; raw ioredis error
  passthrough stays technical English.
- **Build:** `nest-cli.json` assets copy `i18n/**/*.json` into `dist`
  (verified `dist/i18n/{en,fa}` after `pnpm build`); turbo `outputs:
  dist/**` and `Dockerfile.prod`'s `COPY dist` carry catalogs into the
  production image; `tsconfig.json` gains `resolveJsonModule`.
- **Tests:** catalog-consistency spec (key/placeholder/plural parity via
  `Intl.PluralRules('fa')`); `test/i18n.e2e-spec.ts` (resolution matrix,
  headers, fa validation messages, stable error contract, batched
  concurrency isolation, health regression); updated specs pinning English
  literals; service spec asserts the requested catalog keys.
- **Docs:** root `AGENTS.md` gained the permanent "Internationalization and
  Bilingual Development" rule; `apps/api/AGENTS.md` documents the i18n
  architecture and mechanics; `apps/api/ONBOARDING.md` stack table +
  project structure; `docs/current-state.md` implemented list, test counts,
  ADR list; no new environment variables.

## Notable decisions and findings

- Persian terminology chosen by the user: «رمز یک‌بار مصرف» for OTP,
  «شماره تلفن همراه» for phone number, «با موفقیت انجام شد» for the envelope
  success message, «تداخل» for conflict.
- The i18n middleware runs before guards and wraps the whole pipeline in an
  AsyncLocalStorage context; singleton services translate through it.
- Investigation finding (pre-existing, not caused by i18n): issuing dozens
  of parallel first-time supertest connections against the NestJS Fastify
  test app resets them (`read ECONNRESET`); reproduced on a pristine master
  worktree with the same probes. The concurrency isolation e2e therefore
  runs interleaved batches of 2 requests ×10 with an explanatory comment.

## Validation

Final verification run (2026-11-11, delegated, exit codes verified):

- `pnpm typecheck` — pass.
- `pnpm test` — 262/262 unit tests pass (30 files).
- `pnpm test:e2e` — 77/77 e2e tests pass (14 files), including the new
  i18n suite.
- `pnpm lint` — 0 errors (42 pre-existing-style warnings in spec/test files
  only; 8 are `vitest(no-conditional-expect)` etc. across the repo's spec
  suites, none introduced as errors by this task).
- `pnpm format:check` — pass (after formatting the three files this task
  touched).
- `pnpm build` — pass; `dist/i18n/en`, `dist/i18n/fa` present with all five
  catalogs each.
- `pnpm test:redis` (Redis integration) not run — no Redis-script behavior
  changed in this task; Redis-backed behavior was exercised transitively by
  the e2e suite against the real development Redis.

## Status

Implemented; uncommitted (awaiting user approval).
