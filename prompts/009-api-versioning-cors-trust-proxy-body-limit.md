# 009 — API Versioning, CORS, Trust Proxy, and Request Body Limits

## Original Request

Configure foundational HTTP settings in the existing NestJS API (Fastify adapter):

1. Global API prefix `api` with URI-based versioning (`VersioningType.URI`): versioned endpoints under `/api/v1/...`, health check staying at `/health` (version-neutral and explicitly excluded from the prefix).
2. CORS configuration via a new `CORS_ORIGIN` variable: comma-separated allowed origins, trimmed, empty entries ignored, no wildcard, no silent allow-all, framework-handled preflight.
3. New `TRUST_PROXY` variable: only the exact strings `true`/`false`, default `false`, passed to Fastify's `trustProxy` adapter option.
4. New `BODY_LIMIT` variable: positive integer in bytes, default `1048576` (1 MiB), validated at startup and passed to Fastify's `bodyLimit`.
5. Update env validation, env example files, add unit + e2e tests, and create three ADRs (URI versioning, body size limit, global prefix).

Follow-up decisions made during planning:

- `main.ts` obtains adapter constructor options (`trustProxy`, `bodyLimit`) by calling the `serverConfig` registerAs factory directly, because Fastify adapter options must exist before the Nest app (and its `ConfigService`) does; `main.ts` reads `host`/`port` the same way.
- `CORS_ORIGIN` is optional in development/test (unset disables CORS entirely) and fail-fast required when `APP_ENV=production`.
- No 413 e2e test and no new POST endpoint (the API has no body-accepting route); body-limit behavior is covered by schema unit tests plus a wiring assertion.
- The user rejected a separate `app.setup.ts` module: all bootstrap-time configuration lives directly inside the `bootstrap` function in `apps/api/src/main.ts`, enforced by a new "Application Bootstrap" rule in `AGENTS.md`; the e2e helper mirrors that configuration in `test/create-test-app.ts`.

## Implementation

- **`apps/api/src/shared/config/env/schema/server.env.ts`:** added `CORS_ORIGIN` (`z.string().optional().transform(parseCorsOrigins).refine(...)` — parses a comma-separated list into trimmed, non-empty origins; an unset or fully empty value resolves to `undefined`; each entry must satisfy `new URL(entry).origin === entry`, rejecting paths and non-origins without normalizing them), `TRUST_PROXY` (`z.enum(['true','false']).default('false').transform(v => v === 'true')`), and `BODY_LIMIT` (`z.string().refine(/^\d+$/).transform(Number).refine(safe integer && > 0).default(1048576)`). Exported pure helpers `parseCorsOrigins` and `isCorsOriginRequiredInProduction` for unit testability.
- **`apps/api/src/shared/config/env/env.config.ts`:** aggregate `envSchema` gained a `superRefine` that requires `CORS_ORIGIN` when `APP_ENV=production` (fail-fast with a readable prettified error).
- **`apps/api/src/shared/config/server.config.ts`:** `SERVER_CONFIG` factory extended with `corsOrigins`, `trustProxy`, and `bodyLimit`.
- **`apps/api/src/main.ts`:** all bootstrap-time configuration lives inside the `bootstrap` function (per the AGENTS.md "Application Bootstrap" rule): one `serverConfig()` destructuring feeds the `FastifyAdapter({ trustProxy, bodyLimit })` constructor options (with comments explaining proxy-trust spoofing risk and payload-size protection) and `host`/`port`; then `setGlobalPrefix('api', ...)` with an explicit `health` exclusion (comment: `VERSION_NEUTRAL` does not remove the global prefix), `enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })`, and CORS enabled only when origins are configured (no `credentials`, no wildcard). `ConfigService` lookup removed.
- **`apps/api/src/health.controller.ts`:** `@Controller({ path: 'health', version: VERSION_NEUTRAL })`; handler and response contract unchanged.
- **Env files:** `apps/api/env/.env.development` and `.env.test` gained `CORS_ORIGIN`, `TRUST_PROXY`, `BODY_LIMIT` (`.env.test` uses distinctive values `TRUST_PROXY=true` and `BODY_LIMIT=2097152` so e2e can prove the environment reaches Fastify); `.env.example` documents all three with formats, accepted values, and defaults (values left empty per user preference).
- **Unit tests:** `server.env.spec.ts` extended from 13 to 38 tests: CORS parsing (list, whitespace, trailing/repeated commas, unset/empty/only-commas → `undefined`, path-like and scheme-less entries rejected), TRUST_PROXY (default, `true`, `false`, invalid values), BODY_LIMIT (default `1048576`, custom value, empty/non-numeric/decimal/zero/negative/unsafe-integer rejections), and the production CORS predicate.
- **E2E tests (Vitest + supertest, env from `env/.env.test`):** `test/create-test-app.ts` mirrors the `main.ts` bootstrap configuration (adapter options, prefix, versioning, CORS) and accepts an optional `beforeInit` hook for registering raw Fastify routes before the instance is sealed. `test/app.e2e-spec.ts`: greeting at `/api/v1` (200), unversioned `/` (404), undefined `/api/v1/definitely-not-a-route` (404). `test/health.e2e-spec.ts`: `/health` (200, `status: 'ok'`), `/api/v1/health` (404). New `test/cors.e2e-spec.ts`: allowed origin gets `Access-Control-Allow-Origin`; disallowed origin gets no CORS grant (200, header absent); different port/scheme not treated as allowed; preflight from allowed origin (204, ACAO, allow-methods includes `GET`); permitted request headers echoed; preflight from disallowed origin gets no CORS headers. New `test/http-config.e2e-spec.ts`: `initialConfig.bodyLimit === 2097152` (proves the env value — not Fastify's 1048576 default — reached the adapter) and a `/__probe__/ip` route (registered via `beforeInit`) confirming `X-Forwarded-For` is honored under `TRUST_PROXY=true`.
- **ADRs:** ADR-005 (URI-Based API Versioning), ADR-006 (Maximum Request Body Size of 1 MiB), ADR-007 (Global `api` Prefix with `/health` Exception) added to `DECISIONS.md`, all with **Pending** status.
- **Governance:** new "Application Bootstrap" rule in `AGENTS.md` keeping bootstrap-time configuration inside the `bootstrap` function in `main.ts` (no separate `app.setup.ts` file).

## Validation Results (all delegated to a validation subagent)

- `pnpm format` (oxfmt): **PASS** — no files modified on the final run.
- `pnpm lint` (oxlint): **PASS** — 0 warnings, 0 errors.
- `pnpm typecheck` (`tsc --noEmit`): **PASS**.
- Unit tests (vitest): **PASS** — 40/40 (38 schema tests + 2 pre-existing controller specs).
- E2E tests (vitest, env from `env/.env.test`): **PASS** — 13/13 (app routing 3, health 2, CORS 6, adapter wiring 2).

## Issues Found and Fixed During Validation

- `VersioningType` must be imported from `@nestjs/common`, not `@nestjs/platform-fastify` (wrong import crashed every e2e test at app configuration and failed typecheck).
- Fastify does not expose `trustProxy` via `initialConfig` (or any public accessor), so the trustProxy wiring is verified behaviorally (forwarded-header probe with `TRUST_PROXY=true` in `env/.env.test`) instead of by inspecting instance options.
- Lint warnings: supertest-only `.expect()` chains tripped the `expect-expect` rule and two type-only imports were unused; tests were rewritten with vitest assertions and the imports removed.
- A missing `createTestApp` import in `http-config.e2e-spec.ts` (caught by typecheck + e2e).
- `oxfmt` normalized `export class AppModule { }` to `{}` (pre-existing formatting drift).
- The initial implementation placed bootstrap configuration in a separate `src/app.setup.ts`; per user follow-up it was inlined into the `bootstrap` function in `main.ts`, the file was removed, an "Application Bootstrap" rule was added to `AGENTS.md`, and the e2e helper now mirrors the bootstrap configuration inline (tests cannot import `main.ts` because it self-executes `bootstrap()`).

## Remaining Limitations

- No HTTP 413 integration test and no body-accepting endpoint (per user decision); the body-size limit is verified by schema unit tests and the adapter wiring assertion. A 413 e2e test should be added together with the first POST endpoint.
- The production fail-fast for missing `CORS_ORIGIN` is covered by the unit-tested predicate and schema wiring, not by a live production boot.
- `test/create-test-app.ts` duplicates the `main.ts` bootstrap configuration (tests cannot import `main.ts` because it self-executes `bootstrap()`); the route/CORS e2e assertions catch most drift, but the mirror must be updated whenever the bootstrap changes.
- ADR-005, ADR-006, and ADR-007 are **Pending** and await explicit acceptance.
