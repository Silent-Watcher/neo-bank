# 008 — Initial Environment Configuration for the NestJS API

## Original Request

Implement the initial environment configuration for the existing NestJS project using `@nestjs/config` and Zod validation:

1. Install `@nestjs/config` and `zod` (no unnecessary dependencies).
2. Define `APP_ENV`, `HOST`, and `PORT` as a `server config` category.
3. Create an `AppEnv` TypeScript enum under `shared/enums` allowing only `development`, `production`, and `test`, reused directly in the Zod schema.
4. Validate with Zod: `APP_ENV` against the enum (default `development`), `HOST` as a hostname/IPv4/IPv6 address (not a URL), `PORT` coerced to a number constrained to `1–65535` (rejecting empty and non-numeric values) with a custom error message.
5. Configure `ConfigModule` per project conventions; validation runs at startup before the server accepts requests; on failure print a clear error and exit with code `1`.
6. Create `.env.example` and `.env.development` with all three variables; keep `.env.example` committable and `.env.development` excluded from Git.
7. Follow the user's follow-up decisions: env files live in `apps/api/env/`, use Zod's built-in `z.prettifyError` instead of `zod-validation-error`, `HOST=0.0.0.0` in env files, vitest reads its env from `env/.env.test`, bootstrap reads config through `ConfigService` with object destructuring, a new AGENTS.md rule banning `process.env`/`console.log` in source code (single exception: the env validation layer), and an ADR for the `@nestjs/config` + Zod choice.

## Implementation

Following the `nest-config` skill/rule architecture:

- **Dependencies:** `@nestjs/config` 12.0.1 and `zod` 4.6.7 added to `apps/api`.
- **`apps/api/src/shared/enums/app-env.enum.ts`:** `AppEnv` enum (`Development`, `Production`, `Test`).
- **`apps/api/src/shared/errors/env-validation.error.ts`:** minimal `EnvValidationError` error class.
- **`apps/api/src/shared/config/env/schema/server.env.ts`:** `serverEnvSchema` — `APP_ENV: z.enum(AppEnv).default(AppEnv.Development)`, `HOST: z.union([z.ipv4(), z.ipv6(), z.hostname()])`, `PORT: z.coerce.number().int().min(1).max(65535)` with custom error messages. Type inferred as `ServerEnv`.
- **`apps/api/src/shared/config/env/env.config.ts`:** aggregate `envSchema`, `validateEnv()` running `envSchema.safeParse(process.env)` (the only `process.env` access in the codebase), throwing `EnvValidationError(z.prettifyError(error))` on failure; exports the validated `_env` object.
- **`apps/api/src/config/server.config.ts`:** `SERVER_CONFIG = Symbol('SERVER_CONFIG')` + `registerAs` factory mapping `_env.APP_ENV/HOST/PORT`; exports `ServerConfig` type via `ConfigType`.
- **`apps/api/src/shared/config/config.ts`:** central `ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [serverConfig] })`.
- **`apps/api/src/app.module.ts`:** registers `configModule`.
- **`apps/api/src/main.ts`:** reads `{ host, port }` via `app.get(ConfigService).getOrThrow<ServerConfig>(SERVER_CONFIG)` and listens on the validated values; raw `process.env.PORT` access removed.
- **Env files:** `apps/api/env/.env.example` (committed) and `apps/api/env/.env.development` / `env/.env.test` (git-ignored by the existing root `.gitignore` patterns; no `.gitignore` change needed). All use `HOST=0.0.0.0`, `PORT=3001`.
- **Scripts:** `dev` and `test:e2e` wrap the real JS CLI entries in `node --env-file=...` (`node_modules/@nestjs/cli/bin/nest.js`, `node_modules/vitest/vitest.mjs`) because Node 24 rejects `--env-file` in `NODE_OPTIONS` and pnpm's `.bin` entries are shell shims that `node` cannot execute.
- **Tests:** `server.env.spec.ts` unit tests (13) covering enum default/values/rejection, hostname/IPv4/IPv6/URL/empty host cases, and port coercion/range/empty/non-numeric rejections; e2e suite loads env from `env/.env.test`.
- **Governance:** new General Rules in `AGENTS.md` banning `process.env`/`console.log` in source code (single exception: the validation layer), enforced by oxlint `no-console` and `no-process-env` rules with an override for `env.config.ts`; ADR-004 "Use @nestjs/config and Zod for Configuration and Environment Validation" added to `DECISIONS.md` with **Pending** status.

## Validation Results (all delegated to a validation subagent)

- Typecheck (`tsc --noEmit`): **PASS**
- Oxlint: **PASS** — 0 errors, 0 warnings; both new rules and the override are recognized.
- Unit tests (vitest): **PASS** — 15/15 (13 new schema tests + 2 existing).
- E2E tests (vitest, env from `env/.env.test`): **PASS** — 2/2.
- Build (`nest build`, SWC): **PASS**.
- Valid boot (`node --env-file=env/.env.development dist/main.js`): **PASS** — app starts, `/health` returns HTTP 200 on `0.0.0.0:3001`; proves the `SERVER_CONFIG` symbol token resolves through `ConfigService` at runtime.
- Invalid boot (`APP_ENV=staging PORT=65536`): **PASS** — readable `EnvValidationError` with prettified Zod output naming each invalid variable; exit code 1; server never starts.
- Dev script smoke test: **PASS** — SWC compile + Nest boot with `--watch`; port 3001 free and no leftover processes afterwards.
- Gitignore: **PASS** — `env/.env.development` and `env/.env.test` are ignored; `env/.env.example` remains tracked (git rename from the old `apps/api/.env.example`).

## Issues Found and Fixed During Validation

- Wrong relative import path in `src/shared/config/config.ts` (broke typecheck and runtime boot).
- `NODE_OPTIONS=--env-file=...` is rejected by Node 24; scripts rewritten to `node --env-file=...` wrapping the real JS CLI entries.
- `ConfigService.get()` returns `T | undefined`; switched to `getOrThrow<ServerConfig>()` for type-safe, fail-fast destructuring.
- Spec rewritten to avoid `no-conditional-expect` warnings.

## Remaining Limitations

- ADR-004 is **Pending** and awaits explicit acceptance.
- The `start` script intentionally does not load an env file; production environment variables are expected from the runtime environment.
- `env/.env.development` and `env/.env.test` are not committed, by design.
