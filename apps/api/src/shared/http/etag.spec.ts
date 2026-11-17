import { describe, expect, it } from 'vitest';

import { ifNoneMatchSatisfied, weakEtag, weakEtagFor } from './etag.js';

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

describe('weakEtagFor', () => {
  it('produces a quoted weak entity tag', () => {
    expect(weakEtagFor('{"example":true}', 'en')).toMatch(/^W\/"[0-9a-f]{64}"$/);
  });

  it('distinguishes representations served for different locales', () => {
    const serialized = '{"example":true}';
    expect(weakEtagFor(serialized, 'en')).not.toBe(weakEtagFor(serialized, 'fa'));
  });

  it('is stable for the same representation and locale', () => {
    expect(weakEtagFor('stable', 'en')).toBe(weakEtagFor('stable', 'en'));
  });

  it('composes the locale injectively — no representation/locale pair collides', () => {
    // A serialized payload that itself contains the separator followed by a
    // locale-looking suffix must never collide with a shorter payload whose
    // separator and locale land on the same bytes.
    expect(weakEtagFor('payload\nfa', 'en')).not.toBe(weakEtagFor('payload', 'fa'));
    expect(weakEtagFor('payload\nen', 'en')).not.toBe(weakEtagFor('payload', 'en'));
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
