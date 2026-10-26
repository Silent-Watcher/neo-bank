import { describe, expect, it } from 'vitest';

import { ErrorCode } from './error.code.js';
import { buildProblemDetails } from './problem-details.js';

describe('buildProblemDetails', () => {
  it('builds the family Problem Type contract for application error codes', () => {
    const problem = buildProblemDetails({
      status: 500,
      code: ErrorCode.ApplicationError,
      detail: 'An unexpected error occurred.',
      requestId: '550e8400-e29b-41d4-a716-446655440000',
      apiVersion: 'v1',
    });

    expect(problem.type).toBe('/problems/application-error');
    expect(problem.title).toBe('Application Error');
    expect(problem.status).toBe(500);
    expect(problem.detail).toBe('An unexpected error occurred.');
    expect(problem.apiVersion).toBe('v1');
    expect(problem.requestId).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(problem.code).toBe(ErrorCode.ApplicationError);
    expect(() => new Date(problem.timestamp).toISOString()).not.toThrow();
  });

  it('uses about:blank and the reason-phrase title for ordinary HTTP errors', () => {
    const problem = buildProblemDetails({
      status: 404,
      code: ErrorCode.NotFound,
      detail: 'Cannot GET /api/v1/missing',
      requestId: '550e8400-e29b-41d4-a716-446655440000',
      apiVersion: 'v1',
    });

    expect(problem.type).toBe('about:blank');
    expect(problem.title).toBe('Not Found');
    expect(problem.status).toBe(404);
  });

  it('produces a UTC ISO 8601 timestamp', () => {
    const problem = buildProblemDetails({
      status: 400,
      code: ErrorCode.BadRequest,
      detail: 'Invalid payload.',
      requestId: '550e8400-e29b-41d4-a716-446655440000',
      apiVersion: 'neutral',
    });

    expect(problem.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
