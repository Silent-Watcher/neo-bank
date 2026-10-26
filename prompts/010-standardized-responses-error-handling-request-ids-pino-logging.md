# 010 — Standardized API Responses, Error Handling, Request IDs, and Pino Logging

## Original Request

Implement a consistent response contract, centralized HTTP error handling, request ID management, and Pino-based logging in the existing NestJS (Fastify) API:

1. A global interceptor wrapping ordinary successful JSON responses as `{ timestamp, apiVersion, requestId, status, message: 'Success', data }`, with `apiVersion` derived from the URI version (`neutral` for unversioned routes) and explicit exclusions (204/304, HEAD, streams/files/SSE, non-JSON routes, the Problem Type docs page).
2. A global exception filter normalizing all errors into RFC 9457 Problem Details (`application/problem+json`) with extension members `timestamp`, `apiVersion`, `requestId`, and `code`; unknown exceptions become a safe generic 500.
3. An `AppHttpException extends HttpException` carrying a typed `ErrorCode`; centralized error codes and Problem-Type mappings in `shared/errors/error.code.ts`.
4. A family-level Problem Type `/problems/application-error` documented by a version-neutral HTML endpoint excluded from the `api` prefix and the envelope.
5. Request IDs sourced from Fastify's lifecycle (`genReqId` on the adapter): inbound `x-request-id` accepted only as a valid UUIDv4 (lowercase-normalized), absent/invalid values replaced by `crypto.randomUUID()`, invalid headers rejected with a standardized 400 before route handlers, `x-request-id` echoed on every response.
6. Pino logging via `nestjs-pino`: replaces the Nest system logger, single `pino-http` access-log pipeline, request-scoped context, `pino-pretty` in development only, JSON in production/test, sensitive header redaction, `LOG_LEVEL` env var.
7. Unit + e2e tests; ADRs for Pino, nestjs-pino, UUIDv4 request IDs, and envelope exclusions.

## Implementation

- **Dependencies:** `nestjs-pino@5`, `pino@10`, `pino-http@11` (runtime); `pino-pretty@13`, `fastify@5.12.7` (dev, types only — pnpm strict node_modules requires the direct dependency for `fastify` type imports).
- **Envelope:** `src/shared/interceptors/response-envelope.interceptor.ts` registered once as `APP_INTERCEPTOR`. Reads `reply.statusCode` (set by Nest before interceptors run), `request.id`, and resolves `apiVersion` from the request URL. Skip rules: HEAD, 204/304, `reply.sent`, `undefined`/`StreamableFile` payloads, `@Sse` handlers (`SSE_METADATA`), explicit non-JSON `Content-Type`.
- **Errors:** `src/shared/errors/` — `error.code.ts` (`ErrorCode` enum, status→code fallback map, code→Problem-Type map, code→title map), `app-http.exception.ts`, `problem-details.ts` (`buildProblemDetails` shared serializer). `src/shared/filters/problem-details.filter.ts` registered as `APP_FILTER`: string messages and validation arrays joined, unknown errors → generic 500 (never leaks messages/stacks), 5xx logged at `error` with the exception, 4xx at `warn`.
- **Request IDs:** `src/shared/http/request-id.ts` (UUIDv4 validation incl. version/variant bits, `fastifyGenReqId` passed to the Fastify adapter — the single source of truth) and `request-id.lifecycle.ts` (`registerRequestIdLifecycle`: `onRequest` hook echoing `x-request-id` on every response and rejecting invalid headers with 400 Problem Details using the server-generated ID). Called from `bootstrap()` in `main.ts` and mirrored in `test/create-test-app.ts`.
- **Logging:** `src/shared/logging/` — `pino-http.options.ts` (level from config, redaction paths, pino-pretty transport only in development) and `logger.module.ts` (`LoggerModule.forRootAsync` reading `LOG_CONFIG` via `ConfigService.getOrThrow`). `app.useLogger(app.get(Logger))` with `bufferLogs: true` in bootstrap. Filter injects `PinoLogger` (forwards args verbatim to pino, unlike the nestjs-pino `Logger` facade whose last optional param is context).
- **Problems docs:** `src/problems.controller.ts` — version-neutral, prefix-excluded `GET /problems/application-error` returning static HTML via `@Header('Content-Type', 'text/html')`.
- **Config:** new `log.env.ts` schema (`LOG_LEVEL` enum with message derived from `LOG_LEVELS.join(', ')`, default `info`), `log.config.ts` `registerAs(LOG_CONFIG)` factory (`level`, `pretty = APP_ENV === development`), aggregated in `env.config.ts`, loaded in `config.ts`, documented in `env/.env.example`, set in `.env.development` (debug) and `.env.test` (info).
- **Tests:** unit specs for request-id, api-version, error codes, AppHttpException, problem-details, interceptor (wrap + every skip rule), filter (built-in/AppHttp/unknown, array details, no leaks, severities), log schema, pino options, log config factory (dynamic import with stubbed env since `_env` validates at import). E2e: envelope contract (wrap-once, 201, 204/304/HEAD no-body, file/text/SSE unwrapped, header↔body requestId), errors (built-in/AppHttp/unknown, problem+json, no `message`, no leaks, apiVersion on error paths), request IDs (generated/accepted/rejected incl. v1-UUID and multi-value), problems docs page, logging (in-memory sink via `overrideProvider(PARAMS_PROVIDER_TOKEN)`: JSON lines, framework logs on pino, exactly one access log per request, reqId correlation, redacted authorization, single error log with exception). `app.e2e-spec.ts` and `health.e2e-spec.ts` updated to the new contracts.
- **Governance:** AGENTS.md logging rule updated to reference the Pino-backed Logger; ADR-008..ADR-011 added to `DECISIONS.md` (all **Pending**).

## Key Decisions

- `apiVersion` is derived from the request URL (`/api/vN/...` → `vN`, else `neutral`) because Nest 12 does not expose a runtime `request.version` for URI versioning — the prompt itself asks for "the version represented in the request URI".
- `registerRequestIdLifecycle` lives in `shared/http/` (not extracted bootstrap config): the AGENTS.md bootstrap rule covers adapter options/prefix/versioning/CORS, and the prompt requires reusing the exact same error contract between the early rejection and tests.
- `/health` **is** wrapped (ordinary successful JSON; probe status codes unchanged). Terminus 503s normalize to Problem Details.
- Fastify's built-in logger stays off (no `logger` adapter option); pino-http middleware is the only access-log pipeline.
- Unknown 500s use the `/problems/application-error` family type; built-in client errors use `about:blank` with reason-phrase titles.
- Minimal `ErrorCode` set (`APPLICATION_ERROR`, `BAD_REQUEST`, `INVALID_REQUEST_ID`, `NOT_FOUND`) per the "no future business codes" constraint.

## Validation Results

See delegated validation report recorded below after the validation run.

## Remaining Limitations

- ADR-008..ADR-011 are **Pending** and await explicit acceptance.
- No production-boot check (the production fail-fast and JSON logging are covered by unit tests of the options builder and config factory).
- `test/create-test-app.ts` still mirrors the bootstrap configuration inline (tests cannot import `main.ts`, which self-executes `bootstrap()`).
- SSE exclusion is verified by a unit test (SSE metadata skip) and an e2e SSE route returning one event.
