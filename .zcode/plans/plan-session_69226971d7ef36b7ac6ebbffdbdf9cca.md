# Initial Environment Configuration (NestJS + Zod)

Follows the `nest-config` skill/rule architecture, with user-approved adjustments: Zod built-in `z.prettifyError()` instead of `zod-validation-error`, env files under `apps/api/env/`, a new project-wide rule banning `process.env`/`console.log` in source code, and an ADR recording the tooling choice.

## 1. Dependencies (`apps/api`)

- `pnpm add @nestjs/config zod` in `apps/api`. Nothing else.

## 2. New AGENTS.md rule

Add to **General Rules** in `AGENTS.md`:

- Never use `process.env` or `console.log` in source code.
- The single permitted `process.env` access is the one environment validation call in the env validation layer (`apps/api/src/shared/config/env/env.config.ts`).
- Consumers read validated configuration via `_env`/config factories; runtime logging uses the NestJS `Logger`.
- Also enable oxlint's `no-console` and `no-process-env` rules in `apps/api/.oxlintrc.json` so the rule is enforced (with an override/exception for the validation layer); if the installed oxlint version doesn't support a rule, the AGENTS.md rule still stands and I'll report it.

## 3. Decision record

Add an ADR to `DECISIONS.md` (status **Pending**, per the project's decision-record convention): **"Use `@nestjs/config` + Zod for configuration and environment validation"** — covering:

- `@nestjs/config` (`ConfigModule.forRoot`, `registerAs` namespaces with symbol tokens) for typed, DI-friendly configuration;
- Zod for schema-based environment validation at startup, reusing the `AppEnv` enum in the schema;
- Node.js `--env-file` for loading env files (ConfigModule's own env loading disabled via `ignoreEnvFile: true`);
- fail-fast behavior: invalid env → readable `z.prettifyError` message via `EnvValidationError`, process exits with code 1 before the server accepts requests.
  Since you've explicitly requested this ADR, it will be written as part of the implementation; its **Pending** status means it awaits your acceptance before any follow-up work builds further on it. The separate `z.prettifyError`-vs-`zod-validation-error` deviation remains noted inside this ADR as part of the decision.

## 4. New files

- `apps/api/src/shared/enums/app-env.enum.ts` — `enum AppEnv { Development = 'development', Production = 'production', Test = 'test' }`.
- `apps/api/src/shared/errors/env-validation.error.ts` — minimal `EnvValidationError extends Error` (no existing error classes to reuse).
- `apps/api/src/shared/config/env/schema/server.env.ts` — `serverEnvSchema`:
  - `APP_ENV: z.enum(AppEnv)` (reuses the enum directly — no duplicated values),
  - `HOST: z.union([z.ipv4(), z.ipv6(), z.hostname()])` with a readable custom message ("must be a valid hostname, IPv4, or IPv6 address"); if the installed Zod lacks `z.hostname()`, fall back to an RFC-hostname regex in the same union — never URL validation,
  - `PORT: z.coerce.number().int().min(1).max(65535)` (empty string coerces to 0 → rejected; non-numeric → NaN → rejected),
  - plus `export type ServerEnv = z.infer<...>`.
- `apps/api/src/shared/config/env/env.config.ts` — aggregate `envSchema = z.object({ ...serverEnvSchema.shape })`, `validateEnv()` running `envSchema.safeParse(process.env)` (the one allowed `process.env` access), throwing `EnvValidationError(z.prettifyError(error))` on failure; exports `Env` type and `_env` (validated data only, no raw result, no secrets logged).
- `apps/api/src/config/server.config.ts` — `SERVER_CONFIG = Symbol('SERVER_CONFIG')` + `registerAs(SERVER_CONFIG, () => ({ env: _env.APP_ENV, host: _env.HOST, port: _env.PORT }))`, default export.
- `apps/api/src/shared/config/config.ts` — `configModule = ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [serverConfig] })`.
- `apps/api/src/shared/config/env/schema/server.env.spec.ts` — unit tests (AAA): valid hostname/IPv4/IPv6 hosts, `APP_ENV` rejection outside `development|production|test`, PORT coercion and rejection of `0`, `65536`, empty and non-numeric values.
- `apps/api/env/.env.example` — `APP_ENV=development`, `HOST=localhost`, `PORT=3001` (replaces the old `apps/api/.env.example`, which only had `PORT=3001`).
- `apps/api/env/.env.development` — development values (`development`, `localhost`, `3001`); not committed — root `.gitignore`'s `.env.*` / `!.env.example` pair already covers this location (verified with `git check-ignore` after creation).

## 5. Modified files

- `apps/api/src/app.module.ts` — add `configModule` to `AppModule` imports.
- `apps/api/src/main.ts` — remove the raw `process.env.PORT ?? 3001`; bootstrap wraps a dynamic `import('./app.module.js')` in try/catch: on `EnvValidationError`, log `error.message` via NestJS `Logger` (no `console.*`) and `process.exit(1)`. Validation runs at module load, before the server accepts requests; the server listens with validated values (`app.listen(_env.PORT, _env.HOST)`).
- `apps/api/package.json` — `dev` loads the env file via `NODE_OPTIONS="--env-file=env/.env.development" nest start --watch`; `start` stays `node dist/main.js` (production env comes from the runtime environment).
- `apps/api/test/vitest-e2e.config.ts` — add `test.env` with `APP_ENV=test`, `HOST=localhost`, `PORT=3001` so e2e tests (which import `AppModule`) satisfy validation.
- `AGENTS.md` — the new rule above.
- `DECISIONS.md` — the new ADR above.

## 6. Validation (delegated to a subagent per AGENTS.md)

1. Build, typecheck, oxlint, unit + e2e tests (`pnpm --filter api ...`).
2. Startup verification: built app with valid `env/.env.development` boots; with an invalid value (`APP_ENV=staging`, `PORT=99999`) → readable prettified error via Logger, exit code 1, no server started.
3. `git check-ignore apps/api/env/.env.development` confirms it's ignored; `.env.example` remains trackable.

## 7. Wrap-up

- Create the feature record in `prompts/` (next sequential number), stop any processes started for verification, review the final diff, and report. No commit until you explicitly approve; the commit would then include the feature record and use Commitizen.
