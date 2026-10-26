import { describe, expect, it } from 'vitest';

import { NEUTRAL_API_VERSION, resolveApiVersion } from './api-version.js';

describe('resolveApiVersion', () => {
  it('resolves v1 for versioned API URLs', () => {
    expect(resolveApiVersion('/api/v1/hello')).toBe('v1');
    expect(resolveApiVersion('/api/v1')).toBe('v1');
    expect(resolveApiVersion('/api/v1/')).toBe('v1');
  });

  it('resolves higher versions from the URI segment', () => {
    expect(resolveApiVersion('/api/v2/hello')).toBe('v2');
  });

  it('resolves neutral for version-neutral routes', () => {
    expect(resolveApiVersion('/health')).toBe(NEUTRAL_API_VERSION);
    expect(resolveApiVersion('/problems/application-error')).toBe(NEUTRAL_API_VERSION);
  });

  it('resolves neutral for unversioned or unrelated paths', () => {
    expect(resolveApiVersion('/')).toBe(NEUTRAL_API_VERSION);
    expect(resolveApiVersion('/api/hello')).toBe(NEUTRAL_API_VERSION);
    expect(resolveApiVersion('/api/v1')).not.toBe(NEUTRAL_API_VERSION);
  });

  it('does not match version-like paths that are not the version segment', () => {
    expect(resolveApiVersion('/api/versioned/hello')).toBe(NEUTRAL_API_VERSION);
  });

  it('ignores query strings and does not treat them as paths', () => {
    expect(resolveApiVersion('/api/v1/hello?x=1')).toBe('v1');
  });
});
