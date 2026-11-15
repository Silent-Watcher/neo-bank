import { describe, expect, it } from 'vitest';

import { ifNoneMatchSatisfied, weakEtag } from './etag.js';

describe('weakEtag', () => {
  it('produces a quoted weak entity tag', () => {
    expect(weakEtag('{"example":true}')).toMatch(/^W\/"[0-9a-f]{64}"$/);
  });

  it('differs for different bodies', () => {
    expect(weakEtag('a')).not.toBe(weakEtag('b'));
  });

  it('is stable for the same body', () => {
    expect(weakEtag('stable')).toBe(weakEtag('stable'));
  });
});

describe('ifNoneMatchSatisfied', () => {
  const etag = 'W/"abc"';

  it('is unsatisfied when the header is absent or empty', () => {
    expect(ifNoneMatchSatisfied(undefined, etag)).toBe(false);
    expect(ifNoneMatchSatisfied('', etag)).toBe(false);
    expect(ifNoneMatchSatisfied(42, etag)).toBe(false);
  });

  it('matches the exact entity tag', () => {
    expect(ifNoneMatchSatisfied('W/"abc"', etag)).toBe(true);
    // If-None-Match compares weakly: a strong-quoted candidate with the same
    // opaque value matches the weak tag.
    expect(ifNoneMatchSatisfied('"abc"', etag)).toBe(true);
  });

  it('matches one candidate among several', () => {
    expect(ifNoneMatchSatisfied('"other", W/"abc"', etag)).toBe(true);
    expect(ifNoneMatchSatisfied('"other", "def"', etag)).toBe(false);
  });

  it('matches the wildcard candidate', () => {
    expect(ifNoneMatchSatisfied('*', etag)).toBe(true);
    expect(ifNoneMatchSatisfied('"other", *', etag)).toBe(true);
  });

  it('ignores surrounding whitespace in candidates', () => {
    expect(ifNoneMatchSatisfied('  W/"abc"  ', etag)).toBe(true);
    expect(ifNoneMatchSatisfied('"other" , W/"abc"', etag)).toBe(true);
  });
});
