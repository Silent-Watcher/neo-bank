import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';

// Opt-in Conditional GET (ADR-038 §3): one developer-facing route decorator
// carries everything — the runtime metadata the conditional-request
// interceptor reads to enable `If-None-Match` revalidation for the route's
// GET responses, and the OpenAPI extension the Swagger transform keys off to
// document the `If-None-Match` parameter and the bodyless `304` response.
// No `@Res()`, no manual header handling, no envelope handling in
// controllers.
export const CONDITIONAL_GET_METADATA = Symbol('conditional-get');

// The single source of truth for the OpenAPI extension key: the decorator
// writes it onto the operation and the Swagger transform keys the
// documentation off exactly this key (Wave 27 CR-01).
export const CONDITIONAL_GET_EXTENSION = 'x-conditional-get';

export function ConditionalGet(): MethodDecorator {
  return applyDecorators(
    SetMetadata(CONDITIONAL_GET_METADATA, true),
    ApiExtension(CONDITIONAL_GET_EXTENSION, true),
  );
}
