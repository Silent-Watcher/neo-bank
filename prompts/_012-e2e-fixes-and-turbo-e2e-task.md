# E2E Test Fixes and Turbo E2E Task

## User Request

Fix the six failing e2e tests (response envelope and Pino logging specs), and make Turborepo run the e2e suite too — `turbo test` currently only ran the unit tests.

## Root Causes

The six failures had four distinct causes:

1. **`logging.e2e-spec.ts` built its own app** instead of using `createTestApp`, so it never registered `ContractController` — `/api/v1/echo` and `/api/v1/boom` returned 404. The access-log test found no completed request line, the redaction test never saw an `authorization` header, and the unhandled-error test never triggered a 500. Its logger override also replaced the entire pino-http options, silently dropping the redaction configuration.
2. **`reqId` was only available inside `req.id`** on access-log lines (pino-http binds it to child loggers, not the record), so the top-level `accessLogs[0].reqId` assertion failed.
3. **`@Header()` values are applied by the router after interceptors run**, so the envelope interceptor's reply-header content-type check never saw the `text/plain` declared on the contract `text()` route and wrapped its body as JSON.
4. **supertest + Fastify response shapes**: HEAD responses deliver no body at all (`text` is `undefined`, not `''`), and `application/octet-stream` bodies arrive as a Buffer (`text` undefined) — the old assertions on `response.text` could never pass.

## Implementation

- `src/shared/interceptors/response-envelope.interceptor.ts`: `shouldSkip` now reads `@Header`-declared content types from the handler's `HEADERS_METADATA` (non-JSON ⇒ skip) in addition to the existing reply-header check. This also fixes the real `ProblemsController` docs endpoint (`@Header('Content-Type', 'text/html; charset=utf-8')`), which was being JSON-wrapped.
- `src/shared/logging/pino-http.options.ts`: added `customSuccessObject`/`customErrorObject` that lift `req.id` to a top-level `reqId` on every access-log line.
- `test/create-test-app.ts`: new optional `configureModule(builder)` hook so specs can override providers while keeping the production-mirroring bootstrap.
- `test/logging.e2e-spec.ts`: rebuilt on `createTestApp` with `ContractController` registered; the sink override now spreads the real `buildPinoHttpOptions(...)` output so redaction stays in play.
- `test/envelope.e2e-spec.ts`: HEAD asserts no body and the unwrapped payload's `content-length` (16); the file download asserts on the Buffer body.
- Unit tests added (AAA): `@Header`-declared non-JSON content type skips wrapping, JSON `@Header` still wraps, and the access-log object providers lift `reqId`.
- Turborepo: added a `test:e2e` task to `turbo.json`; root `test` is now `turbo test test:e2e` (so the pre-push hook's `pnpm test` covers both suites) and a dedicated root `test:e2e` script runs only the e2e task.

## Validation

- `pnpm run test:e2e` (apps/api): 41/41 pass across 9 files.
- Full-suite results recorded in the final validation report below.

## Remaining Limitations

- `turbo test` output now includes e2e runs, so a failing e2e suite fails `pnpm test` (and the pre-push hook) — intentional, but slower pushes.
