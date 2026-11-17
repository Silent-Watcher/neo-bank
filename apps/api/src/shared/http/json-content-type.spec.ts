import 'reflect-metadata';

import { HEADERS_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';

import type { HttpResponseLike } from './http-boundary.js';
import {
  declaredContentType,
  isJsonContentType,
  isNonJsonRepresentation,
} from './json-content-type.js';

describe('isJsonContentType', () => {
  it('matches the JSON structured-syntax forms', () => {
    expect(isJsonContentType('application/json')).toBe(true);
    expect(isJsonContentType('application/json; charset=utf-8')).toBe(true);
    expect(isJsonContentType('application/problem+json')).toBe(true);
    expect(isJsonContentType('application/vnd.api+json')).toBe(true);
  });

  it('does not classify a substring match as JSON', () => {
    // Wave 25 SEC-02: a loose includes('json') would treat newline-delimited
    // or arbitrary types as JSON and wrap/tag them.
    expect(isJsonContentType('application/x-ndjson')).toBe(false);
    expect(isJsonContentType('application/notjson')).toBe(false);
    expect(isJsonContentType('text/plain')).toBe(false);
    expect(isJsonContentType('text/event-stream')).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(isJsonContentType(undefined)).toBe(false);
    expect(isJsonContentType(42)).toBe(false);
    expect(isJsonContentType(null)).toBe(false);
  });
});

describe('declaredContentType', () => {
  it('returns the @Header-declared content type case-insensitively', () => {
    const handler = function handler() {};
    Reflect.defineMetadata(
      HEADERS_METADATA,
      [{ name: 'Content-Type', value: 'text/plain' }],
      handler,
    );

    expect(declaredContentType(handler)).toBe('text/plain');
  });

  it('returns undefined for handlers without header metadata', () => {
    const handler = function handler() {};

    expect(declaredContentType(handler)).toBeUndefined();
  });
});

describe('isNonJsonRepresentation', () => {
  function replyWith(contentType: string | undefined): HttpResponseLike {
    return {
      statusCode: 200,
      getHeader: () => contentType,
      header: () => replyWith(contentType),
      status: () => replyWith(contentType),
      send: () => undefined,
      writableEnded: false,
      headersSent: false,
    };
  }

  it('flags a declared non-JSON content type', () => {
    const handler = function handler() {};
    Reflect.defineMetadata(
      HEADERS_METADATA,
      [{ name: 'Content-Type', value: 'text/html' }],
      handler,
    );

    expect(isNonJsonRepresentation(handler, replyWith(undefined))).toBe(true);
  });

  it('flags a non-JSON content type set on the reply', () => {
    const handler = function handler() {};

    expect(isNonJsonRepresentation(handler, replyWith('text/html; charset=utf-8'))).toBe(true);
  });

  it('accepts declared and reply JSON content types', () => {
    const handler = function handler() {};
    Reflect.defineMetadata(
      HEADERS_METADATA,
      [{ name: 'Content-Type', value: 'application/json' }],
      handler,
    );

    expect(isNonJsonRepresentation(handler, replyWith(undefined))).toBe(false);
    expect(isNonJsonRepresentation(handler, replyWith('application/json'))).toBe(false);
  });

  it('accepts a route with neither a declared nor a reply content type', () => {
    expect(isNonJsonRepresentation(function handler() {}, replyWith(undefined))).toBe(false);
  });
});
