import type { SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';

// Small reusable OpenAPI schema definitions for the application's two global
// response contracts (success envelope interceptor, RFC 9457 Problem Details
// error filter) so endpoint documentation matches what the application
// actually returns instead of hand-rolled per-endpoint shapes.

/**
 * Converts a Zod schema into an OpenAPI schema using Zod 4's native JSON
 * Schema generation, keeping validation rules and their documentation from
 * drifting apart.
 *
 * Zod's JSONSchema type is structurally wider than OpenAPI's SchemaObject
 * (JSON Schema boolean keywords such as `not: false` have no OpenAPI
 * equivalent). The request schemas documented here only produce plain
 * object/string schemas — never boolean keywords — so the conversion is
 * performed through a JSON round-trip, which drops unsupported shapes at
 * runtime rather than silently misrepresenting them.
 */
export function toJsonSchemaObject(schema: z.ZodType): SchemaObject {
  const jsonSchema = z.toJSONSchema(schema);
  // $schema targets JSON Schema draft 2020-12; the generated OpenAPI
  // document is 3.0 and does not declare or use it.
  delete jsonSchema.$schema;
  return JSON.parse(JSON.stringify(jsonSchema));
}

/**
 * Builds the standardized success envelope schema
 * (`{ timestamp, apiVersion, requestId, status, message, data }`) around the
 * given payload schema.
 */
export function successEnvelopeSchema(data: SchemaObject): SchemaObject {
  return {
    type: 'object',
    properties: {
      timestamp: { type: 'string', format: 'date-time' },
      apiVersion: { type: 'string', examples: ['v1', 'neutral'] },
      requestId: { type: 'string', format: 'uuid' },
      status: { type: 'integer', description: 'HTTP status code of the response.' },
      message: { type: 'string', examples: ['Success'] },
      data,
    },
    required: ['timestamp', 'apiVersion', 'requestId', 'status', 'message', 'data'],
  };
}

/** RFC 9457 Problem Details with the application's extension members. */
export const problemDetailsSchema: SchemaObject = {
  type: 'object',
  properties: {
    type: { type: 'string', format: 'uri-reference', examples: ['about:blank'] },
    title: { type: 'string' },
    status: { type: 'integer' },
    detail: { type: 'string' },
    timestamp: { type: 'string', format: 'date-time' },
    apiVersion: { type: 'string' },
    requestId: { type: 'string', format: 'uuid' },
    code: { type: 'string', description: 'Stable application error code.' },
  },
  required: ['type', 'title', 'status', 'detail', 'timestamp', 'apiVersion', 'requestId', 'code'],
};
