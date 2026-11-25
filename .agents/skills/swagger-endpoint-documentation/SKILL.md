---
name: swagger-endpoint-documentation
description: Implement and maintain Swagger endpoint documentation using the one-endpoint-one-custom-decorator convention. Use whenever creating or modifying NestJS controller endpoints.
---

# Swagger Endpoint Documentation Skill

## 1. Purpose

This skill teaches the project's mandatory convention for documenting NestJS controller endpoints with `@nestjs/swagger`:

**One endpoint → One `Swagger`-prefixed function → One `applyDecorators` composition → One custom decorator in the Controller.**

The goal is to keep Swagger documentation organized outside controller implementations, make every endpoint's documentation independently discoverable, and establish a consistent standard for all future NestJS controllers without introducing unnecessary abstractions.

## 2. When to Use

Consult this skill whenever you:

- Create a new NestJS controller endpoint.
- Add an HTTP route to an existing controller.
- Modify an existing endpoint's request/response contract.
- Add or update Swagger/OpenAPI documentation.
- Review or refactor controller documentation.
- Onboard to the project and need to understand the documentation standard.

## 3. Implementation Workflow

### Step 1: Inspect the existing controller and feature structure

- Locate the feature module (e.g., `src/modules/enrollments/`).
- Identify the controller file (e.g., `enrollments.controller.ts`).
- Understand the existing endpoints and their runtime decorators.

### Step 2: Understand the endpoint's actual runtime behavior

- Read the handler implementation.
- Note: HTTP method, route path, status codes, request body, path parameters, headers, response payloads, and error conditions.
- **Critical:** The Swagger documentation must match actual runtime behavior exactly.

### Step 3: Identify request and response schemas

- Request bodies: Zod schemas (source of truth) → converted via `toJsonSchemaObject()`.
- Response payloads: Use shared `successEnvelopeSchema()` and `problemDetailsSchema` from `#swagger/openapi.schemas.js`.
- Reuse existing schema constants — do not manually recreate JSON schemas.

### Step 4: Locate or create the feature-specific Swagger documentation file

- File: `<feature>.swagger.ts` (e.g., `enrollments.swagger.ts`).
- Location: Same directory as the controller (e.g., `src/modules/enrollments/enrollments.swagger.ts`).
- If creating a new file, follow the existing structure and import conventions.

### Step 5: Create one dedicated exported Swagger function for the endpoint

- Function name: `Swagger<UseCaseOrMethodName>` with `Swagger` prefix.
  - Examples: `SwaggerRequestEnrollmentChallenge`, `SwaggerSubmitNationalCode`.
- Export the function: `export function SwaggerXxx() { ... }`

### Step 6: Put every method-level Swagger decorator directly inside `applyDecorators`

```typescript
export function SwaggerSubmitNationalCode() {
  return applyDecorators(
    ApiOperation({ summary: '...', description: '...' }),
    ApiParam({ name: 'publicId', type: 'string', format: 'uuid', description: '...' }),
    ApiBody({ schema: nationalCodeStepJsonSchema, description: '...' }),
    ApiOkResponse({ description: '...', schema: stepSubmissionResponseSchema }),
    ApiBadRequestResponse({ description: '...', schema: problemDetailsSchema }),
    ApiResponse({ status: HttpStatus.CONFLICT, description: '...', schema: problemDetailsSchema }),
    // ... other endpoint-specific decorators
  );
}
```

- Include ALL: `@ApiOperation`, `@ApiParam`, `@ApiBody`, `@ApiOkResponse`/`@ApiResponse`, `@ApiBadRequestResponse`, `@ApiHeader`, and any other endpoint-specific Swagger decorators.
- Do not omit metadata to make the function shorter.

### Step 7: Use the mandatory `Swagger` naming prefix

- Pattern: `Swagger<UseCaseOrMethodName>`.
- The `Swagger` prefix must make the responsibility immediately obvious when reading a controller.

### Step 8: Reuse existing schema constants

- Import from feature's schema file (e.g., `./enrollments.schema.js`):
  - `challengeRequestJsonSchema`, `verifyRequestJsonSchema`
  - `nationalCodeStepJsonSchema`, `fullNameStepJsonSchema`, etc.
  - `stepSubmissionResponseSchema`
- Import shared response schemas from `#swagger/openapi.schemas.js`:
  - `problemDetailsSchema`, `successEnvelopeSchema`

### Step 9: Import and apply the custom decorator to the controller method

```typescript
@Post(':publicId/step/national-code')
@Throttle({ short: EnrollmentsController.STEP_RATE_LIMIT })
@HttpCode(HttpStatus.OK)
@SwaggerSubmitNationalCode()
async submitNationalCode(...) { ... }
```

- Apply exactly one custom Swagger decorator per endpoint method.
- Keep runtime decorators (`@Post`, `@HttpCode`, `@Throttle`, etc.) separate and independent.

### Step 10: Verify the generated OpenAPI operation

- Run the project's e2e Swagger test: `pnpm test:e2e -- test/swagger.e2e-spec.ts`
- Verify the generated OpenAPI document contains the correct endpoint, request schema, and response definitions.
- If the test fails due to new endpoints, update the test's expected paths array.

### Step 11: Run relevant project checks

- `pnpm typecheck` — TypeScript compilation
- `pnpm lint` — oxlint
- `pnpm format:check` — oxfmt
- `pnpm test` — unit tests
- `pnpm test:e2e` — e2e tests (if applicable)

## 4. Practical Example

### Feature-specific Swagger file (`enrollments.swagger.ts`)

```typescript
import { HttpStatus, applyDecorators } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBody, ApiHeader, ApiOkResponse, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';

import { challengeRequestJsonSchema, verifyRequestJsonSchema, ... } from './enrollments.schema.js';
import { problemDetailsSchema, successEnvelopeSchema } from '#swagger/openapi.schemas.js';

export function SwaggerRequestEnrollmentChallenge() {
  return applyDecorators(
    ApiOperation({ summary: 'Request an enrollment challenge', description: '...' }),
    ApiHeader({ name: 'Idempotency-Key', required: true, description: '...', schema: { type: 'string', minLength: 1, maxLength: 255 } }),
    ApiBody({ schema: challengeRequestJsonSchema, description: '...' }),
    ApiResponse({ status: HttpStatus.ACCEPTED, description: 'Empty 202 body', }),
    ApiBadRequestResponse({ description: 'Validation failed or rate limit', schema: problemDetailsSchema }),
    // ... other responses
  );
}
```

### Controller (`enrollments.controller.ts`)

```typescript
import { SwaggerRequestEnrollmentChallenge } from './enrollments.swagger.js';

@Post('challenge')
@DeferredRateLimit()
@Throttle({ short: { limit: 2, ttl: seconds(120) } })
@UseInterceptors(DeferredRateLimitInterceptor)
@Idempotent(challengeIdempotentOptions)
@HttpCode(HttpStatus.ACCEPTED)
@SwaggerRequestEnrollmentChallenge()
requestChallenge(...) { ... }
```

## 5. Design Restrictions

**Explicitly do NOT introduce:**

- Generic Swagger decorator factories.
- Shared response decorator factories.
- Generic endpoint documentation configuration objects.
- Decorator registries.
- Nested decorator composition layers.
- Inheritance-based Swagger documentation abstractions.
- Conditional logic intended to accommodate multiple endpoint types.
- Additional abstraction layers merely to eliminate repeated lines.

**Some repetition between endpoint documentation functions is acceptable and intentional.** Prefer direct, readable, endpoint-specific decorator definitions over DRY abstractions. Reuse schemas, not unnecessary decorator abstractions.

## 6. Validation Checklist

When creating or modifying endpoint documentation, verify:

- [ ] Correct `Swagger` naming convention (`Swagger<UseCase>`).
- [ ] One custom Swagger function per endpoint.
- [ ] Direct `applyDecorators` composition.
- [ ] Correct HTTP method and route (matches controller).
- [ ] Operation summary and description present.
- [ ] Request body schema (if applicable).
- [ ] Path parameters documented.
- [ ] Required headers documented.
- [ ] Successful response status and schema.
- [ ] Error response statuses and schemas.
- [ ] Empty response bodies correctly represented (no schema, `content: undefined`).
- [ ] Consistency with actual runtime behavior (status codes, headers, body).
- [ ] Generated OpenAPI output verified via e2e test.

## 7. Official NestJS References

- Custom decorators: https://docs.nestjs.com/custom-decorators
- OpenAPI decorators: https://docs.nestjs.com/openapi/decorators
- OpenAPI operations: https://docs.nestjs.com/openapi/operations

Follow the installed NestJS and `@nestjs/swagger` versions. Do not blindly copy examples that might not match the project's dependencies.
