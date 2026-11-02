# Swagger / OpenAPI Integration

## User Request

The user asked for a Swagger/OpenAPI integration in the `apps/api` NestJS
application using the official `@nestjs/swagger` package on the existing
Fastify adapter: basic metadata from existing configuration, availability
strictly limited to the development environment, accurate documentation of
the real endpoints (no artificial test controllers), Zod 4 as the validation
source of truth with JSON Schema generation instead of duplicated DTOs, no
authentication documentation, an ADR, a mandatory AGENTS.md documentation
rule, and tests covering environment isolation and document accuracy.

## Implementation

- **Dependencies:** `@nestjs/swagger` 12.1.0 and `@fastify/static` 10.1.8
  (peer needed for Fastify UI asset serving). No wrapper or conversion
  packages.
- **Setup** (`src/shared/swagger/swagger.setup.ts`): `setupSwagger(app)` with
  `DocumentBuilder` (title "Neo Bank API", version mirroring the URI
  versioning default). The UI registers at `/docs` — deliberately outside
  the `api` prefix since it is a development aid, not part of the versioned
  API surface. Explicit `jsonDocumentUrl: docs/json` and
  `yamlDocumentUrl: docs/yaml` because @nestjs/swagger's Fastify defaults
  are `docs-json`/`docs-yaml`.
- **Dev-only gate:** in `bootstrap()` (`main.ts`), `if (env === AppEnv.Development)`
  using the existing validated server configuration — no second environment
  mechanism, no `NODE_ENV`. Routes do not exist in test/production.
- **Shared response schemas** (`src/shared/swagger/openapi.schemas.ts`):
  `successEnvelopeSchema(data)` for the `{ timestamp, apiVersion, requestId,
  status, message, data }` envelope, `problemDetailsSchema` for RFC 9457
  errors, and `toJsonSchemaObject(schema)` converting Zod schemas via
  Zod 4's native `z.toJSONSchema()` (JSON round-trip drops the draft-2020-12
  `$schema` key and any shapes OpenAPI cannot represent).
- **Documented endpoints** (all real controllers):
  - `POST /api/v1/enrollments/otp` — request body generated from
    `requestOtpSchema` (required `phoneNumber`, validated `^09\d{9}$`
    pattern), 200 envelope with `{ phoneNumber, otp }`, 400 Problem Details.
  - `GET /health` — envelope-wrapped Terminus result with
    `ok/degraded/error/shutting_down` statuses and 503 Problem Details.
    Response decorators are declared above `@HealthCheck()` because method
    decorators evaluate bottom-up and Terminus's own response schema must be
    overridden by the envelope-accurate one.
  - `GET /api/v1` (greeting) and `GET /problems/application-error` (HTML
    Problem Type page, documented with its `text/html` content type).
- **Tests** (`test/swagger.e2e-spec.ts`): no Swagger routes in test
  environment (404); in development (via the same `setupSwagger` the
  bootstrap gates) — UI 200 HTML, valid OpenAPI 3.0 document, exact path
  list without duplicated prefixes, OTP request schema derived from the Zod
  schema, health degraded-status enum, and 400/503 Problem Details schemas.

## Validation

- `pnpm typecheck` — passed.
- `pnpm test` — 24 files / 166 tests passed.
- `pnpm test:e2e` — 13 files / 56 tests passed.
- Manual dev verification: `pnpm dev`, then `curl http://localhost:3001/docs`
  (200, text/html) and `/docs/json` (valid OpenAPI 3.0.0 document listing
  `/api/v1`, `/api/v1/enrollments/otp`, `/health`,
  `/problems/application-error`). Dev server stopped afterwards; port 3001
  freed.

## Documentation

- `DECISIONS.md`: ADR-014 (Swagger/OpenAPI with development-only
  availability) — **Pending**.
- `apps/api/AGENTS.md`: Swagger architecture bullet, `swagger/` in the
  structure, and the **Mandatory API Documentation Rule** (documentation is
  part of the same task; endpoint incomplete without it; constraints against
  fake endpoints and premature auth decorators).
- `apps/api/ONBOARDING.md`: stack table entry, `swagger/` in structure,
  documentation-rule workflow note.
- `docs/current-state.md`: Swagger feature, test counts, ADR list.
