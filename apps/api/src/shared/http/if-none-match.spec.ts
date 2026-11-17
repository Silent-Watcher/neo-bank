import { describe, expect, it } from 'vitest';

import { ifNoneMatchSatisfied } from './if-none-match.js';

describe('ifNoneMatchSatisfied', () => {
  // The shape every generated validator has: a weak tag over a 64-hex
  // opaque value.
  const etag = 'W/"abc123"';

  describe('weak comparison (RFC 9110 §13.1.2)', () => {
    it('matches the exact weak entity tag', () => {
      expect(ifNoneMatchSatisfied('W/"abc123"', etag)).toBe(true);
    });

    it('matches a strong-quoted candidate with the same opaque value', () => {
      expect(ifNoneMatchSatisfied('"abc123"', etag)).toBe(true);
    });

    it('matches a weak candidate against a strong current tag (prefix ignored on both sides)', () => {
      expect(ifNoneMatchSatisfied('W/"abc123"', '"abc123"')).toBe(true);
    });

    it('compares opaque values case-sensitively', () => {
      expect(ifNoneMatchSatisfied('W/"ABC123"', etag)).toBe(false);
      expect(ifNoneMatchSatisfied('"ABC123"', etag)).toBe(false);
    });
  });

  describe('entity-tag lists', () => {
    it('matches one candidate among several', () => {
      expect(ifNoneMatchSatisfied('"other", W/"abc123"', etag)).toBe(true);
      expect(ifNoneMatchSatisfied('"other", "def456"', etag)).toBe(false);
    });

    it('treats commas inside quoted opaque tags as literal characters', () => {
      // etagc allows commas; the naive comma split of the pre-Phase-2 parser
      // corrupted such lists (ADR-038 §4).
      expect(ifNoneMatchSatisfied('"a,b", "abc123"', etag)).toBe(true);
      expect(ifNoneMatchSatisfied('"a,b,c"', etag)).toBe(false);
    });

    it('ignores optional whitespace around and between candidates', () => {
      expect(ifNoneMatchSatisfied('  W/"abc123"  ', etag)).toBe(true);
      expect(ifNoneMatchSatisfied('"other" , W/"abc123"', etag)).toBe(true);
      expect(ifNoneMatchSatisfied('\t"other",\t"abc123"\n', etag)).toBe(true);
    });

    it('combines multiple header values into one list', () => {
      expect(ifNoneMatchSatisfied(['"other"', 'W/"abc123"'], etag)).toBe(true);
      expect(ifNoneMatchSatisfied(['"other"', '"def456"'], etag)).toBe(false);
    });

    it('bounds the COMBINED multi-value input, not each line (Wave 27 SEC-01)', () => {
      const line = 'a'.repeat(3000);
      const oversizedPair = [`W/"${line}"`, `W/"${line}"`];
      expect(oversizedPair[0].length).toBeLessThan(4096);
      expect(oversizedPair.reduce((total, value) => total + value.length, 0)).toBeGreaterThan(4096);
      expect(ifNoneMatchSatisfied(oversizedPair, etag)).toBe(false);

      // An early match wins before the combined budget trips.
      const earlyMatch = [etag, `W/"${'a'.repeat(4000)}"`];
      expect(ifNoneMatchSatisfied(earlyMatch, etag)).toBe(true);
    });

    it('ignores malformed candidates while a valid sibling still matches', () => {
      expect(ifNoneMatchSatisfied('W/bare, "abc123"', etag)).toBe(true);
      expect(ifNoneMatchSatisfied('"bad"extra, "abc123"', etag)).toBe(true);
    });

    it('never matches a header consisting solely of malformed candidates', () => {
      expect(ifNoneMatchSatisfied('W/bare', etag)).toBe(false);
      expect(ifNoneMatchSatisfied('"bad"extra', etag)).toBe(false);
      expect(ifNoneMatchSatisfied('abc123', etag)).toBe(false);
      expect(ifNoneMatchSatisfied('"unterminated', etag)).toBe(false);
      expect(ifNoneMatchSatisfied('w/"abc123"', etag)).toBe(false);
    });
  });

  describe('wildcard', () => {
    it('matches `*` as the entire field value', () => {
      expect(ifNoneMatchSatisfied('*', etag)).toBe(true);
      expect(ifNoneMatchSatisfied('  *  ', etag)).toBe(true);
    });

    it('does not honor `*` inside a list (RFC 9110: `*` OR a list, never both)', () => {
      expect(ifNoneMatchSatisfied('"other", *', etag)).toBe(false);
      expect(ifNoneMatchSatisfied('*, "other"', etag)).toBe(false);
    });
  });

  describe('absent and malformed input (safe failure)', () => {
    it('is unsatisfied when the header is absent, empty, or not a string', () => {
      expect(ifNoneMatchSatisfied(undefined, etag)).toBe(false);
      expect(ifNoneMatchSatisfied('', etag)).toBe(false);
      expect(ifNoneMatchSatisfied('   ', etag)).toBe(false);
      expect(ifNoneMatchSatisfied(42, etag)).toBe(false);
      expect(ifNoneMatchSatisfied(null, etag)).toBe(false);
      expect(ifNoneMatchSatisfied([], etag)).toBe(false);
    });

    it('rejects control and non-latin1 characters inside the opaque tag', () => {
      expect(ifNoneMatchSatisfied('"ab\tc"', etag)).toBe(false);
      expect(ifNoneMatchSatisfied('"ab😀c"', etag)).toBe(false);
    });

    it('accepts obs-text (latin1) characters inside the opaque tag', () => {
      // etagc includes %x80-FF: a latin1 opaque tag must round-trip through
      // the parser (Wave 27 CR-03 — the acceptance branch was previously
      // only exercised negatively).
      const latin1Tag = 'W/"caf\u00e9123"';
      expect(ifNoneMatchSatisfied(latin1Tag, latin1Tag)).toBe(true);
    });

    it('accepts an empty opaque tag grammatically without ever matching', () => {
      expect(ifNoneMatchSatisfied('""', etag)).toBe(false);
    });

    it('is unsatisfied for an oversized field value', () => {
      // A syntactically valid 5000-candidate list is rejected wholesale by
      // the bounded input size (DoS posture, ADR-038 §4).
      const oversized = Array.from({ length: 250 }, () => '"aaaaaaaaaaaaaaaaaaaa"').join(', ');
      expect(oversized.length).toBeGreaterThan(4096);
      expect(ifNoneMatchSatisfied(oversized, etag)).toBe(false);
    });

    it('accepts a field value of exactly the cap and rejects one past it', () => {
      // Wave 27 CR-03: pin the cap boundary so an off-by-one cannot flip the
      // behavior silently — `W/"` + 4092 opaque characters + `"` = 4096.
      const opaque = 'a'.repeat(4092);
      const cappedTag = `W/"${opaque}"`;
      expect(cappedTag.length).toBe(4096);
      expect(ifNoneMatchSatisfied(cappedTag, cappedTag)).toBe(true);
      expect(ifNoneMatchSatisfied(`W/"${opaque}a"`, `W/"${opaque}a"`)).toBe(false);
    });
  });

  describe('current entity tag', () => {
    it('is unsatisfied when the current tag does not parse (fail-safe)', () => {
      expect(ifNoneMatchSatisfied('"abc123"', 'garbage')).toBe(false);
      expect(ifNoneMatchSatisfied('*', 'unterminated"')).toBe(false);
    });
  });
});
