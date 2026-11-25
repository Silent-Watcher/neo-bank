# Swagger Endpoint Documentation Rule

## Purpose

Establish a consistent, maintainable standard for documenting NestJS controller endpoints with `@nestjs/swagger`. Every endpoint must have its own dedicated custom decorator function that composes all Swagger metadata via `applyDecorators`.

## Mandatory Conventions

1. **One endpoint = one dedicated custom Swagger decorator function.**
   - Each controller method must have exactly one custom Swagger decorator applied.
   - No inline Swagger decorators (`@ApiOperation`, `@ApiBody`, `@ApiResponse`, etc.) on controller methods.

2. **Every custom function must use `applyDecorators`.**
   - Import from `@nestjs/common`.
   - Compose all Swagger decorators for that endpoint directly inside the function.

3. **Every custom function must have the `Swagger` prefix in its name.**
   - Pattern: `Swagger<UseCaseOrMethodName>` (e.g., `SwaggerRequestEnrollmentChallenge`, `SwaggerSubmitNationalCode`).
   - The `Swagger` prefix makes the responsibility immediately obvious when reading a controller.

4. **All method-level Swagger decorators for an endpoint must be defined directly inside its dedicated function.**
   - Include: `@ApiOperation`, `@ApiParam`, `@ApiBody`, `@ApiOkResponse`/`@ApiResponse`, `@ApiBadRequestResponse`, `@ApiHeader`, and any other endpoint-specific Swagger decorators.
   - Do not omit metadata to make the function shorter.

5. **Swagger documentation functions must be located in a feature-specific documentation file.**
   - File naming: `<feature>.swagger.ts` (e.g., `enrollments.swagger.ts`).
   - Co-located with the feature module (e.g., `src/modules/enrollments/enrollments.swagger.ts`).
   - Not in a shared/global documentation folder.

6. **Existing schema constants and schema conversion utilities must be reused.**
   - Request body schemas: Zod schemas converted via `toJsonSchemaObject()`.
   - Response schemas: `successEnvelopeSchema()`, `problemDetailsSchema` from shared Swagger utilities.
   - Do not duplicate Zod validation rules or manually recreate JSON schemas.

7. **Endpoint-specific documentation must remain explicit and accurate.**
   - Preserve actual HTTP status codes, response descriptions, and schemas.
   - Do not document irrelevant or impossible response codes.
   - Do not create conflicting duplicate response definitions for the same HTTP status.

8. **Runtime NestJS decorators must remain separate from Swagger documentation decorators.**
   - Keep HTTP route decorators (`@Post`, `@Get`, etc.), `@HttpCode`, `@Throttle`, `@UseInterceptors`, `@UseGuards`, `@UsePipes`, validation pipes, and business logic decorators independent.
   - Order: Swagger decorator first, then runtime decorators (or vice versa — just keep them visually separate).

9. **Generated OpenAPI output must be checked when creating or modifying endpoint documentation.**
   - Run the project's e2e Swagger test (`test/swagger.e2e-spec.ts`).
   - Verify the generated OpenAPI document contains the correct endpoint, request schema, and response definitions.

## Design Restrictions (Do Not Introduce)

- Generic Swagger decorator factories.
- Shared response decorator factories.
- Generic endpoint documentation configuration objects.
- Decorator registries.
- Nested decorator composition layers.
- Inheritance-based Swagger documentation abstractions.
- Conditional logic intended to accommodate multiple endpoint types.
- Additional abstraction layers merely to eliminate repeated lines.

**Some repetition between endpoint documentation functions is acceptable and intentional.** The goal is explicit, discoverable, and independently maintainable endpoint documentation — not DRYness at the cost of clarity.

## Validation Checklist

When creating or modifying endpoint documentation:

- [ ] Correct `Swagger` naming convention.
- [ ] One custom Swagger function per endpoint.
- [ ] Direct `applyDecorators` composition.
- [ ] Correct HTTP method and route (matches controller).
- [ ] Operation summary and description present.
- [ ] Request body schema (if applicable).
- [ ] Path parameters documented.
- [ ] Required headers documented.
- [ ] Successful response status and schema.
- [ ] Error response statuses and schemas.
- [ ] Empty response bodies correctly represented (no schema).
- [ ] Consistency with actual runtime behavior.
- [ ] Generated OpenAPI output verified.
