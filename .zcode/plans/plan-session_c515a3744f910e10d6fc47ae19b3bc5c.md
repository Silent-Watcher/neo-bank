# Standardized Responses, RFC 9457 Errors, Request IDs, and Pino Logging

## Verified facts that shape the design (checked against installed deps and @nestjs/core 12.2.0 source)

- **No interceptors/filters/middleware/logging exist yet** — all four concerns are added from scratch. Nest 12.2.0, Fastify 5.12.7 (via `@nestjs/platform-fastify`, which bundles `@fastify/middie` 9.3.5), Zod 4, ESM (`.js` import suffixes), Vitest 5 + supertest.
- **Status code is available to interceptors**: `router-execution-context.js:69` sets `reply.statusCode` (from `@HttpCode` or method default, e.g. POST→201) _before_ interceptors run — so the envelope reads `reply.statusCode`, no Reflector needed.
- **Unknown-route 404s flow through global filters**: `routes-resolver.js:77-93` registers a Fastify `setNotFoundHandler` that throws `NotFoundException` through the router exception-filter chain (includes `APP_FILTER` globals). No custom 404 handler needed.
- **`request.version` is NOT set at runtime for URI versioning** (version is baked into registered paths) — `apiVersion` will be derived from the request URL, which is literally what the prompt requires ("the version represented in the request URI").
- **nestjs-pino v5** supports `@nestjs/common` 12.0.2+ with `pino@10` + `pino-http@11`, Node ≥22.12 (we're on 24). It runs `pino-http` as Nest middleware; on Fastify, middie copies Fastify's `request.id` onto the raw request and pino-http keeps it. So **`genReqId` on the FastifyAdapter is the single source of truth** for request IDs, and we must NOT pass `logger` to the adapter (Fastify's built-in request logging stays off → no duplicate access logs; pino-http is the only HTTP log pipeline).

## New dependencies (apps/api)

- Runtime: `nestjs-pino` (v5), `pino` (^10), `pino-http` (^11)
- Dev: `pino-pretty` (dev only; never enabled in production/test)

## New files

**Shared errors — `src/shared/errors/`**

- `error.code.ts` — `ErrorCode` enum: `ApplicationError`, `BadRequest`, `InvalidRequestId`, `NotFound` (only codes needed by current behavior). Centralized mappings in the same file: status→code fallback map (`400→BAD_REQUEST`, `404→NOT_FOUND`, fallback `APPLICATION_ERROR`), and code→Problem-Type map (`ApplicationError` & `InvalidRequestId` → `/problems/application-error`; ordinary built-in errors → `about:blank` per RFC 9457). Titles: reason phrase for `about:blank`, stable code titles for the family. No dynamic URI construction from enum names.
- `app-http.exception.ts` — `AppHttpException extends HttpException` with `constructor(code: ErrorCode, detail: string, status: HttpStatus)`; stays compatible with Nest's standard exception model. Built-in exceptions remain usable directly.
- `problem-details.ts` — shared serializer `buildProblemDetails({ status, code, detail, requestId, apiVersion })` returning `{ type, title, status, detail, timestamp, apiVersion, requestId, code }`. **Used by both the Nest filter and the Fastify early rejection** so the contract is identical. `application/problem+json` content type set by callers.

**Shared HTTP lifecycle — `src/shared/http/`**

- `request-id.ts` — `X_REQUEST_ID_HEADER` constant, `isValidUuidV4()` (regex validating full structure incl. version nibble `4` and variant `[89ab]`; rejects joined multi-value headers naturally), and `fastifyGenReqId(req)`: valid header → lowercased value; absent or invalid → `crypto.randomUUID()` (invalid values are never echoed or trusted).
- `api-version.ts` — `resolveApiVersion(url)`: returns `v1`/`v2`… for `/api/vN/...` URLs (project's established `api` prefix + `v` version format), `neutral` for `/health`, `/problems/application-error`, and any unversioned path. Works uniformly for success, errors, and unknown-route 404s.

**Envelope and filter**

- `src/shared/interceptors/response-envelope.interceptor.ts` — wraps ordinary successful JSON responses as `{ timestamp, apiVersion, requestId, status, message: 'Success', data }`. `timestamp` = `new Date().toISOString()`; `requestId` = Fastify `request.id`; `status` = actual `reply.statusCode`. **Skip rules** (preserve body/streaming behavior): `HEAD` method; status `204`/`304`; `reply.sent` (raw reply usage / streams); `data === undefined`; `data instanceof StreamableFile` (file downloads); handler has `SSE_METADATA` (@Sse routes); explicit non-JSON `content-type` header set via `@Header` (covers the HTML Problem-Type docs endpoint). Registered **once** as `APP_INTERCEPTOR` in `AppModule` (no `useGlobalInterceptors`, no double wrap). No response DTO/factory classes.
- `src/shared/filters/problem-details.filter.ts` — global `APP_FILTER` normalizing: `AppHttpException` (code/detail/status from the exception), built-in `HttpException` (detail from `getResponse()` — string messages and validation message arrays joined safely; code from the status mapping; `about:blank` type), and unknown exceptions → generic `500`, code `APPLICATION_ERROR`, family type, safe detail (`An unexpected error occurred.`), never exposing messages/stacks/queries. Body `status` always equals the HTTP status. No `message` member. Logging via injected nestjs-pino `Logger` (request-scoped → carries reqId automatically): 5xx at `error` with stack, 4xx at `warn` without stack — no duplicate logging elsewhere.

**Problems docs endpoint**

- `src/problems.controller.ts` — `@Controller({ path: 'problems/application-error', version: VERSION_NEUTRAL })`, `@Get()` returning a concise static HTML explanation (extension members, error-code stability, family strategy) with `@Header('Content-Type', 'text/html')`. Excluded from the `api` global prefix in bootstrap so the `type` URI `/problems/application-error` resolves to the endpoint itself.

**Logging — `src/shared/logging/`**

- `logger.module.ts` — preconfigured `LoggerModule.forRootAsync({ useFactory: (configService) => buildPinoHttpOptions(configService.getOrThrow(LOG_CONFIG)), inject: [ConfigService] })`, imported by `AppModule`.
- `pino-http.options.ts` — pure `buildPinoHttpOptions({ level, pretty })`: development → `transport: { target: 'pino-pretty' }`; production/test → plain JSON; `redact` for `req.headers.authorization`, `req.headers.cookie`, `res.headers['set-cookie']`, `req.headers['x-api-key']`/`x-auth-token` (censor `[Redacted]`); no request/response body logging (pino-http default).

**Config (follows nest-config skill + `agents/rules/nest-config.md`)**

- `src/shared/config/env/schema/log.env.ts` — new `LOG_LEVEL` variable: `z.enum(['fatal','error','warn','info','debug','trace']).default('info')`.
- `src/shared/config/log.config.ts` — `LOG_CONFIG` symbol + `registerAs` factory → `{ level, pretty }` (`pretty` = `APP_ENV === Development`); added to the `load` array in `shared/config/config.ts` and the schema aggregate in `env.config.ts`.
- Env files: `LOG_LEVEL` documented in `.env.example`, set in `.env.development` / `.env.test`.

## Modified files

- `src/main.ts` (all inside `bootstrap()`, per the AGENTS.md bootstrap rule): adapter gains `genReqId: fastifyGenReqId`; `NestFactory.create(..., { bufferLogs: true })` for early bootstrap logging; `app.useLogger(app.get(Logger))` (nestjs-pino) to replace Nest's default logger; `setGlobalPrefix('api', { exclude: [health, problems/application-error] })`; after create, register on the raw Fastify instance: (1) `onRequest` hook setting `reply.header('x-request-id', request.id)` on every response, (2) `onRequest` rejection hook — if header present but not a valid UUIDv4, reply `400` with `buildProblemDetails(...)` (code `INVALID_REQUEST_ID`, the _generated_ request id), `application/problem+json`, `x-request-id` header, and a `warn` log with the generated id (invalid value not logged). This runs before route handlers and before the ID could ever be trusted; the filter also sets the header on error paths (covers 404s), so every response carries it.
- `src/app.module.ts` — imports the logger module; providers: `APP_INTERCEPTOR` (envelope), `APP_FILTER` (problem-details).
- `test/create-test-app.ts` — mirrors the new bootstrap wiring (genReqId, `bufferLogs`, `useLogger`, hooks, prefix exclusion), and gains an optional extra-controllers parameter so e2e specs can register throwaway contract-test routes (201/204/304/HEAD/stream/SSE/error routes) without touching production code.
- `test/app.e2e-spec.ts`, `test/health.e2e-spec.ts` — updated for the new contracts: `/api/v1` body is now the envelope with `data: 'Hello World!'`; `/health` returns `body.data.status === 'ok'` with `apiVersion: 'neutral'`; 404s are `application/problem+json`.
- `AGENTS.md` — the "use the NestJS `Logger`" rule is updated to reference Pino via nestjs-pino (governance stays accurate).
- `DECISIONS.md` — four new ADRs in the existing format, all **Pending**, presented for acceptance when done: ADR-008 Pino for structured logging; ADR-009 nestjs-pino (why the integration package is needed: replaces Nest's system logger via `useLogger`, request-scoped logging with automatic reqId correlation through AsyncLocalStorage, single access-log pipeline via pino-http middleware — Pino alone can't hook into Nest's DI/logger lifecycle); ADR-010 UUIDv4 request IDs (native `crypto.randomUUID()`, correlation needs, no time-ordering requirement); ADR-011 envelope exclusions (204/304/HEAD, streams/files/SSE, explicit non-JSON like the docs endpoint).
- `prompts/010-standardized-responses-error-handling-request-ids-pino-logging.md` — feature record (request, implementation, decisions, validation results).

## Tests (Vitest, AAA; unit colocated, e2e in `test/`)

Unit specs: request-id (valid/invalid v4, other versions, multi-value, lowercase normalization, genReqId paths), api-version resolver, error.code mappings, `AppHttpException`, problem-details builder, envelope interceptor (wrap + every skip rule), filter (built-in normalization incl. message arrays, AppHttpException, unknown 500 with no leak, content type), log env schema + config factory, pino options builder (pretty only in dev, redaction paths).

E2e specs: envelope contract (wrap-once, `Success`, ISO UTC timestamp, status incl. 201, `apiVersion: 'v1'`, requestId === header, 204/304/HEAD no-body, stream/non-JSON unwrapped); error contract (NotFound → about:blank + `NOT_FOUND`, unknown route 404 → problem+json through the filter, BadRequest with array messages, AppHttpException → family type + code, unknown error → safe 500, content type, no stack/message leak); request IDs (generated v4 when absent, accepted+lowercased when valid, rejected 400 with fresh valid v4 for malformed/other-version/multi-value, handler not invoked on rejection); problems docs endpoint (HTML, no envelope); logging (app built with an in-memory pino destination: exactly one req/res access-log pair per request — no duplicates, reqId matches the response header, authorization header redacted, JSON in test env).

## Validation (delegated to a validation subagent, results reported verbatim)

`pnpm format` → `pnpm lint` → `pnpm typecheck` → unit tests (`vitest run`) → e2e (`node --env-file=env/.env.test ... test:e2e`). Broken-by-design existing assertions are updated as listed above; regressions fixed.

## Notable decisions to be aware of

- `/health` **is** wrapped (it's an ordinary successful JSON response; probes rely on status codes, which don't change). Terminus 503s will be normalized to problem+json.
- Minimal 4-code `ErrorCode` set per the prompt's "no future business codes" rule; a consistent `APPLICATION_ERROR` fallback covers unmapped statuses.
- Unknown 500s use the `/problems/application-error` family type (application-level error); ordinary built-in client errors use `about:blank` with the standard reason-phrase title.
- `LOG_LEVEL` is a new validated env var (default `info`) following the BODY_LIMIT precedent.
- Contingency (verified unlikely): if Fastify 404s somehow bypass the global filter in e2e, register a custom `setNotFoundHandler` reusing the shared serializer.

Sources: [nestjs-pino (GitHub)](https://github.com/iamolegga/nestjs-pino), [Fastify Logging docs](https://fastify.dev/docs/v5.4.x/Reference/Logging)
