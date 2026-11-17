import { describe, expect, it } from 'vitest';

import type { OpenAPIObject, OperationObject, ParameterObject } from '@nestjs/swagger';

import { applyConditionalGetDocumentation } from './conditional-get.openapi.js';

function emptyDocument(paths: OpenAPIObject['paths']): OpenAPIObject {
  return {
    openapi: '3.0.1',
    info: { title: 'test', description: '', version: '1' },
    paths,
  } as OpenAPIObject;
}

function getOperation(responses: OperationObject['responses'] = { '200': { description: 'OK' } }): {
  pathItem: { get: OperationObject };
} {
  return { pathItem: { get: { responses } } };
}

function operationOf(document: OpenAPIObject, path: string): OperationObject {
  return document.paths[path].get as OperationObject;
}

function headerParameters(operation: OperationObject): ParameterObject[] {
  return (operation.parameters ?? []).filter(
    (parameter): parameter is ParameterObject => !('$ref' in parameter),
  );
}

describe('applyConditionalGetDocumentation', () => {
  it('documents the If-None-Match header parameter and a bodyless 304 on GET operations', () => {
    const document = applyConditionalGetDocumentation(
      emptyDocument({ '/resource': getOperation().pathItem }),
    );
    const operation = operationOf(document, '/resource');

    const ifNoneMatch = headerParameters(operation).find((p) => p.name === 'If-None-Match');
    expect(ifNoneMatch).toMatchObject({
      in: 'header',
      name: 'If-None-Match',
      required: false,
      schema: { type: 'string' },
    });
    expect(ifNoneMatch?.description).toContain('304 Not Modified');
    // A valid quoted weak entity-tag example.
    expect((ifNoneMatch?.schema as { example: string }).example).toMatch(/^W\/"[0-9a-f]{64}"$/);

    const notModified = operation.responses?.['304'];
    expect(notModified).toBeDefined();
    expect(notModified).not.toHaveProperty('content');
    expect(notModified).toMatchObject({
      description: expect.stringContaining('Not Modified'),
      headers: {
        ETag: { schema: { type: 'string' }, example: expect.stringMatching(/^W\/"/) },
      },
    });
  });

  it('documents the ETag header on the success response, merging with existing headers', () => {
    const document = applyConditionalGetDocumentation(
      emptyDocument({
        '/resource': {
          get: {
            responses: {
              '200': {
                description: 'OK',
                headers: { 'X-Custom': { description: 'custom', schema: { type: 'string' } } },
                content: { 'application/json': { schema: { type: 'object' } } },
              },
            },
          },
        },
      }),
    );
    const success = operationOf(document, '/resource').responses?.['200'];
    if (success === undefined || '$ref' in success) {
      throw new Error('expected the 200 response to be a concrete ResponseObject');
    }

    expect(success.headers?.['ETag']).toBeDefined();
    expect(success?.headers?.['X-Custom']).toEqual({
      description: 'custom',
      schema: { type: 'string' },
    });
    // The body schema is untouched.
    expect(success?.content?.['application/json']).toBeDefined();
  });

  it('skips GET operations whose documented success response is non-JSON-only', () => {
    // The runtime tags and revalidates JSON representations only; a GET
    // serving e.g. text/html must not be documented as revalidatable
    // (Wave 26 CR-01) — exactly the Problem Type page's shape.
    const document = applyConditionalGetDocumentation(
      emptyDocument({
        '/problems/application-error': {
          get: {
            responses: {
              '200': {
                description: 'OK',
                content: { 'text/html; charset=utf-8': { schema: { type: 'string' } } },
              },
            },
          },
        },
      }),
    );
    const operation = operationOf(document, '/problems/application-error');
    const success = operation.responses?.['200'];
    if (success === undefined || '$ref' in success) {
      throw new Error('expected the 200 response to be a concrete ResponseObject');
    }

    expect(operation.parameters).toBeUndefined();
    expect(operation.responses?.['304']).toBeUndefined();
    expect(success.headers?.ETag).toBeUndefined();
    expect(success.content?.['text/html; charset=utf-8']).toBeDefined();
  });

  it('documents GET operations with mixed JSON and non-JSON success content', () => {
    const document = applyConditionalGetDocumentation(
      emptyDocument({
        '/mixed': {
          get: {
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': { schema: { type: 'object' } },
                  'text/html': { schema: { type: 'string' } },
                },
              },
            },
          },
        },
      }),
    );

    expect(headerParameters(operationOf(document, '/mixed'))).toHaveLength(1);
    expect(operationOf(document, '/mixed').responses?.['304']).toBeDefined();
  });

  it('keeps a manually documented ETag header on the success response verbatim', () => {
    // Wave 26 CR-03: the merge order makes manual ETag documentation win —
    // pin it so a spread-order refactor cannot silently overwrite it.
    const manualEtag = {
      description: 'Application-specific tag documentation',
      schema: { type: 'string', pattern: '^"app-"' },
    };
    const document = applyConditionalGetDocumentation(
      emptyDocument({
        '/resource': {
          get: {
            responses: {
              '200': {
                description: 'OK',
                headers: { ETag: manualEtag },
              },
            },
          },
        },
      }),
    );
    const success = operationOf(document, '/resource').responses?.['200'];
    if (success === undefined || '$ref' in success) {
      throw new Error('expected the 200 response to be a concrete ResponseObject');
    }

    expect(success.headers?.ETag).toEqual(manualEtag);
  });

  it('never touches HEAD, POST, or other operations', () => {
    const document = applyConditionalGetDocumentation(
      emptyDocument({
        '/resource': {
          get: { responses: { '200': { description: 'OK' } } },
          head: { responses: { '200': { description: 'OK' } } },
          post: { responses: { '201': { description: 'Created' } } },
        },
      }),
    );
    const pathItem = document.paths['/resource'];

    for (const method of ['head', 'post'] as const) {
      expect(pathItem[method]?.parameters).toBeUndefined();
      expect(pathItem[method]?.responses?.['304']).toBeUndefined();
    }
  });

  it('does not duplicate the parameter when one already exists (case-insensitively)', () => {
    const document = applyConditionalGetDocumentation(
      emptyDocument({
        '/resource': {
          get: {
            parameters: [
              { in: 'header', name: 'if-none-match', required: false, schema: { type: 'string' } },
            ],
            responses: { '200': { description: 'OK' } },
          },
        },
      }),
    );
    const operation = operationOf(document, '/resource');

    expect(
      headerParameters(operation).filter((p) => p.name?.toLowerCase() === 'if-none-match'),
    ).toHaveLength(1);
  });

  it('does not duplicate the parameter when it is inherited from the path item level', () => {
    const document = applyConditionalGetDocumentation(
      emptyDocument({
        '/resource': {
          parameters: [
            { in: 'header', name: 'If-None-Match', required: false, schema: { type: 'string' } },
          ],
          get: { responses: { '200': { description: 'OK' } } },
        },
      }),
    );
    const operation = operationOf(document, '/resource');

    expect(headerParameters(operation)).toHaveLength(0);
    expect(document.paths['/resource'].parameters).toHaveLength(1);
  });

  it('adds the parameter when a $ref parameter does not resolve to an If-None-Match header', () => {
    const document = applyConditionalGetDocumentation(
      emptyDocument({
        '/resource': {
          get: {
            parameters: [{ $ref: '#/components/parameters/IfNoneMatch' }],
            responses: { '200': { description: 'OK' } },
          },
        },
      }),
    );
    const operation = operationOf(document, '/resource');

    // The component map is absent, so the $ref cannot resolve to the header —
    // the transform adds its own parameter exactly once.
    expect(headerParameters(operation).filter((p) => p.name === 'If-None-Match')).toHaveLength(1);
  });

  it('resolves a $ref to a header parameter and does not duplicate it', () => {
    const document: OpenAPIObject = emptyDocument({
      '/resource': {
        get: {
          parameters: [{ $ref: '#/components/parameters/IfNoneMatch' }],
          responses: { '200': { description: 'OK' } },
        },
      },
    });
    document.components = {
      parameters: {
        IfNoneMatch: {
          in: 'header',
          name: 'If-None-Match',
          required: false,
          schema: { type: 'string' },
        },
      },
    };

    const result = applyConditionalGetDocumentation(document);

    expect(headerParameters(operationOf(result, '/resource'))).toHaveLength(0);
  });

  it('does not follow chained $refs (one-level resolution contract)', () => {
    // A $ref pointing at another $ref is not followed — the transform adds
    // its own parameter exactly once instead (ADR-038 §6, Wave 26 SEC-03).
    const document: OpenAPIObject = emptyDocument({
      '/resource': {
        get: {
          parameters: [{ $ref: '#/components/parameters/First' }],
          responses: { '200': { description: 'OK' } },
        },
      },
    });
    document.components = {
      parameters: {
        First: { $ref: '#/components/parameters/Second' },
        Second: {
          in: 'header',
          name: 'If-None-Match',
          required: false,
          schema: { type: 'string' },
        },
      },
    };

    const result = applyConditionalGetDocumentation(document);

    expect(headerParameters(operationOf(result, '/resource'))).toHaveLength(1);
  });

  it('terminates on a cyclic $ref without recursion', () => {
    // A developer-authored self-referencing component must not overflow the
    // stack at document-build time (Wave 26 SEC-03): resolution is one hop,
    // so the cycle is never entered.
    const document: OpenAPIObject = emptyDocument({
      '/resource': {
        get: {
          parameters: [{ $ref: '#/components/parameters/Self' }],
          responses: { '200': { description: 'OK' } },
        },
      },
    });
    document.components = {
      parameters: {
        Self: { $ref: '#/components/parameters/Self' },
      },
    };

    const result = applyConditionalGetDocumentation(document);

    expect(headerParameters(operationOf(result, '/resource'))).toHaveLength(1);
  });

  it('preserves a manually documented 304 response verbatim', () => {
    const custom304 = {
      description: 'Custom conditional semantics',
      headers: { 'X-Custom-304': { description: 'custom', schema: { type: 'string' } } },
    };
    const document = applyConditionalGetDocumentation(
      emptyDocument({
        '/resource': { get: { responses: { '200': { description: 'OK' }, '304': custom304 } } },
      }),
    );

    expect(operationOf(document, '/resource').responses?.['304']).toEqual(custom304);
  });

  it('preserves a $ref 304 response', () => {
    const document: OpenAPIObject = emptyDocument({
      '/resource': {
        get: {
          responses: {
            '200': { description: 'OK' },
            '304': { $ref: '#/components/responses/NotModified' },
          },
        },
      },
    });

    const result = applyConditionalGetDocumentation(document);

    expect(operationOf(result, '/resource').responses?.['304']).toEqual({
      $ref: '#/components/responses/NotModified',
    });
  });

  it('adds the 304 even when the If-None-Match parameter already exists', () => {
    const document = applyConditionalGetDocumentation(
      emptyDocument({
        '/resource': {
          get: {
            parameters: [
              { in: 'header', name: 'If-None-Match', required: false, schema: { type: 'string' } },
            ],
            responses: { '200': { description: 'OK' } },
          },
        },
      }),
    );

    expect(operationOf(document, '/resource').responses?.['304']).toBeDefined();
  });

  it('is idempotent — transforming twice changes nothing', () => {
    const firstPass = applyConditionalGetDocumentation(
      emptyDocument({
        '/resource': getOperation().pathItem,
        '/other': getOperation({ '200': { description: 'OK' } }).pathItem,
      }),
    );
    const snapshot = JSON.parse(JSON.stringify(firstPass));

    const secondPass = applyConditionalGetDocumentation(firstPass);

    expect(secondPass).toEqual(snapshot);
  });

  it('does not mutate other paths and tolerates GET operations without a 200 response', () => {
    const document = applyConditionalGetDocumentation(
      emptyDocument({
        '/no-success': getOperation({ '204': { description: 'No Content' } }).pathItem,
      }),
    );

    const operation = operationOf(document, '/no-success');
    expect(operation.responses?.['304']).toBeDefined();
    expect(operation.responses?.['204']).toEqual({ description: 'No Content' });
  });
});
