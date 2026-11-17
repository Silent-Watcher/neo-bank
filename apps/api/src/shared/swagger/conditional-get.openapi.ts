import { HttpStatus } from '@nestjs/common';
import type {
  OpenAPIObject,
  OperationObject,
  ParameterObject,
  PathItemObject,
  ReferenceObject,
  ResponseObject,
} from '@nestjs/swagger';

import { CONDITIONAL_GET_EXTENSION } from '#http/conditional-get.decorator.js';
import { isJsonContentType } from '#http/json-content-type.js';

// Centralized conditional-GET documentation for the generated OpenAPI
// document (ADR-038 §6): only GET operations that opted in through the
// `@ConditionalGet()` decorator — carrying the `x-conditional-get` OpenAPI
// extension — are documented as revalidatable: an optional `If-None-Match`
// request header parameter and a bodyless `304` response carrying the `ETag`
// header. HEAD and every other method stay untouched, and undecorated
// operations are never modified — the documentation claims exactly the
// runtime's opt-in behavior. Decorated GET operations whose documented
// success response is non-JSON-only (e.g. a text/html body) are skipped,
// matching the runtime, which tags and revalidates JSON representations
// only. The transform runs once per generated document (dev-only, ADR-014)
// and is idempotent: every addition is guarded by a presence check, so
// transforming twice changes nothing.
//
// Prototype-pollution invariant (Wave 26 SEC-02): the document is generated
// by `SwaggerModule.createDocument` from the application's own controller
// metadata and is NEVER derived from request input, and every key written
// here is a compile-time constant — there is no path by which an
// attacker-chosen key could enter these spreads.

const IF_NONE_MATCH_HEADER = 'If-None-Match';
const NOT_MODIFIED_DESCRIPTION =
  'Not Modified — the current representation matches one of the entity tags listed in `If-None-Match`. The response carries no body.';
const IF_NONE_MATCH_DESCRIPTION =
  'Entity tags of representations previously received for this resource. ' +
  'A matching tag — compared weakly (the `W/` prefix is ignored), with `*` matching any current representation — ' +
  'is answered with `304 Not Modified` and no response body. Malformed or non-matching values receive the full response.';
const ETAG_HEADER_NAME = 'ETag';
const ETAG_HEADER_DESCRIPTION =
  'The weak entity tag of the current representation (`W/"<sha256>"`), composed over the application payload and the resolved response locale.';
const ETAG_EXAMPLE = 'W/"9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"';

const etagHeaderSchema = {
  description: ETAG_HEADER_DESCRIPTION,
  schema: { type: 'string' },
  example: ETAG_EXAMPLE,
} as const;

/**
 * Documents conditional-GET support on GET operations that opted in through
 * the `@ConditionalGet()` decorator (`x-conditional-get` extension) whose
 * success response is a JSON representation. Mutates the given document in
 * place (the generated document is a fresh object per `setupSwagger` call)
 * and returns it. Never touches undecorated operations, non-GET operations,
 * manually documented `If-None-Match` parameters, or manually documented
 * `304` responses.
 */
export function applyConditionalGetDocumentation(document: OpenAPIObject): OpenAPIObject {
  for (const pathItem of Object.values(document.paths ?? {})) {
    const operation = pathItem.get;
    if (operation === undefined || !hasConditionalGetExtension(operation)) continue;

    applyToOperation(operation, pathItem, document);
  }

  return document;
}

// The `@ConditionalGet()` decorator applies the extension through
// `@nestjs/swagger`'s `ApiExtension`; the generated operation type does not
// carry the key, so the read is typed through a property-adding intersection.
function hasConditionalGetExtension(operation: OperationObject): boolean {
  type OperationWithExtension = OperationObject & { [CONDITIONAL_GET_EXTENSION]?: unknown };
  return (operation as OperationWithExtension)[CONDITIONAL_GET_EXTENSION] === true;
}

function applyToOperation(
  operation: OperationObject,
  pathItem: PathItemObject,
  document: OpenAPIObject,
): void {
  if (documentsTaglessSuccessOnly(operation)) return;

  if (
    !documentsIfNoneMatch(operation.parameters, document) &&
    !inheritsIfNoneMatch(pathItem, document)
  ) {
    operation.parameters = [
      ...(operation.parameters ?? []),
      {
        in: 'header',
        name: IF_NONE_MATCH_HEADER,
        required: false,
        description: IF_NONE_MATCH_DESCRIPTION,
        schema: { type: 'string', example: ETAG_EXAMPLE },
      } satisfies ParameterObject,
    ];
  }

  // A manually documented 304 (or a $ref to one) is preserved verbatim; the
  // generated entry documents the bodyless response with the ETag header the
  // API actually sends.
  if (!documentsNotModified(operation.responses)) {
    operation.responses = {
      ...operation.responses,
      [String(HttpStatus.NOT_MODIFIED)]: {
        description: NOT_MODIFIED_DESCRIPTION,
        headers: { [ETAG_HEADER_NAME]: { ...etagHeaderSchema } },
      } satisfies ResponseObject,
    };
  }

  // The ETag header on the success response: merge-only, so manually
  // documented headers are never overwritten.
  const success = operation.responses?.['200'];
  if (success !== undefined && !isReference(success)) {
    success.headers = {
      [ETAG_HEADER_NAME]: { ...etagHeaderSchema },
      ...success.headers,
    };
  }
}

// Exclusive upper bound of the 2xx status class (same rationale as the
// interceptor's constant: the installed HttpStatus enum names 300
// `AMBIGUOUS` and has no `MULTIPLE_CHOICES` member).
const SUCCESS_STATUSES_MAX_EXCLUSIVE = 300;

// A decorated GET whose every documented 2xx success response can never
// carry a tagged payload is never tagged or revalidated by the runtime —
// documenting conditional support for it would be inaccurate (Wave 26 CR-01,
// Wave 27 CR-02). A success response is tagless when its status is
// intrinsically bodyless (204/304) or when it declares solely non-JSON media
// types; a `200` without a documented body is assumed to carry one (only the
// schema is missing). Absent or $ref success responses cannot be inspected
// and stay documented.
function documentsTaglessSuccessOnly(operation: OperationObject): boolean {
  const documentedSuccesses = Object.entries(operation.responses ?? {}).filter(
    ([status]) =>
      Number(status) >= HttpStatus.OK && Number(status) < SUCCESS_STATUSES_MAX_EXCLUSIVE,
  );
  if (documentedSuccesses.length === 0) return false;

  return documentedSuccesses.every(([status, response]) => {
    if (response === undefined || isReference(response)) return false;
    if (Number(status) === HttpStatus.NO_CONTENT || Number(status) === HttpStatus.NOT_MODIFIED) {
      return true;
    }

    const mediaTypes = Object.keys(response.content ?? {});
    return mediaTypes.length > 0 && mediaTypes.every((mediaType) => !isJsonContentType(mediaType));
  });
}

function documentsIfNoneMatch(
  parameters: (ParameterObject | ReferenceObject)[] | undefined,
  document: OpenAPIObject,
): boolean {
  return (
    parameters?.some((parameter) => isHeaderNamed(parameter, document, IF_NONE_MATCH_HEADER)) ??
    false
  );
}

function inheritsIfNoneMatch(pathItem: PathItemObject, document: OpenAPIObject): boolean {
  return documentsIfNoneMatch(pathItem.parameters, document);
}

function documentsNotModified(responses: OperationObject['responses']): boolean {
  return responses?.[String(HttpStatus.NOT_MODIFIED)] !== undefined;
}

/**
 * One-level `$ref` resolution (ADR-038 §6): a parameter may reference a
 * `components.parameters` entry, and that entry must be the concrete header
 * itself. Resolution is a single bounded hop — chained `$ref`s are not
 * followed — so cyclic developer-authored metadata can never recurse
 * (Wave 26 SEC-03).
 */
function isHeaderNamed(
  parameter: ParameterObject | ReferenceObject,
  document: OpenAPIObject,
  name: string,
): boolean {
  let current: ParameterObject | ReferenceObject | undefined = parameter;
  if (isReference(current)) {
    current = document.components?.parameters?.[referenceName(current.$ref)];
  }

  return (
    current !== undefined &&
    !isReference(current) &&
    current.in === 'header' &&
    current.name?.toLowerCase() === name.toLowerCase()
  );
}

function referenceName(ref: string): string {
  return ref.split('/').pop() ?? '';
}

function isReference(value: unknown): value is ReferenceObject {
  return typeof value === 'object' && value !== null && '$ref' in value;
}
