import { describe, expect, it } from 'vitest';

import { calendarDayUtcRange } from './utc-datetime.js';

describe('calendarDayUtcRange (ADR-030)', () => {
  it('computes Tehran day boundaries as exact UTC instants (+03:30, no DST)', () => {
    // Act
    const { startUtc, endUtc } = calendarDayUtcRange('2026-11-15', 'Asia/Tehran');

    // Assert
    expect(startUtc.toISOString()).toBe('2026-11-14T20:30:00.000Z');
    expect(endUtc.toISOString()).toBe('2026-11-15T20:30:00.000Z');
  });

  it('yields a 23-hour day across a spring-forward transition (America/New_York)', () => {
    // Act — 2026-03-08 is the US spring-forward date; the local day is short.
    const { startUtc, endUtc } = calendarDayUtcRange('2026-03-08', 'America/New_York');

    // Assert
    expect(startUtc.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(endUtc.toISOString()).toBe('2026-03-09T04:00:00.000Z');
    expect(endUtc.getTime() - startUtc.getTime()).toBe(23 * 60 * 60 * 1000);
  });

  it('yields a 25-hour day across a fall-back transition (America/New_York)', () => {
    // Act — 2026-11-01 is the US fall-back date; the local day is long.
    const { startUtc, endUtc } = calendarDayUtcRange('2026-11-01', 'America/New_York');

    // Assert
    expect(endUtc.getTime() - startUtc.getTime()).toBe(25 * 60 * 60 * 1000);
  });

  it('rolls over month and year boundaries', () => {
    // Act
    const { startUtc, endUtc } = calendarDayUtcRange('2025-12-31', 'Asia/Tehran');

    // Assert
    expect(startUtc.toISOString()).toBe('2025-12-30T20:30:00.000Z');
    expect(endUtc.toISOString()).toBe('2025-12-31T20:30:00.000Z');
  });

  it('resolves skipped midnight to the transition instant (America/Santiago spring-forward)', () => {
    // Act — 2024-09-08 jumps 00:00 → 01:00 local; the day starts at the
    // transition instant, exercising the third offset-refinement pass.
    const { startUtc, endUtc } = calendarDayUtcRange('2024-09-08', 'America/Santiago');

    // Assert
    expect(startUtc.toISOString()).toBe('2024-09-08T04:00:00.000Z');
    expect(endUtc.toISOString()).toBe('2024-09-09T03:00:00.000Z');
    expect(endUtc.getTime() - startUtc.getTime()).toBe(23 * 60 * 60 * 1000);
  });

  it('spans the doubled midnight on a fall-back date (America/Santiago)', () => {
    // Act — 2024-04-06 passes 00:00 twice; the range covers the wall-clock
    // day from the first midnight to the start of the next one.
    const { startUtc, endUtc } = calendarDayUtcRange('2024-04-06', 'America/Santiago');

    // Assert
    expect(startUtc.toISOString()).toBe('2024-04-06T03:00:00.000Z');
    expect(endUtc.toISOString()).toBe('2024-04-07T04:00:00.000Z');
    expect(endUtc.getTime() - startUtc.getTime()).toBe(25 * 60 * 60 * 1000);
  });

  it('rejects malformed local dates and unknown zones', () => {
    // Act & Assert
    expect(() => calendarDayUtcRange('2026-3-8', 'Asia/Tehran')).toThrow(/Invalid local date/);
    expect(() => calendarDayUtcRange('not-a-date', 'Asia/Tehran')).toThrow(/Invalid local date/);
    expect(() => calendarDayUtcRange('2026-11-15', 'Not/AZone')).toThrow(/Invalid time zone/i);
  });

  it('rejects semantically invalid dates that a shape check alone would accept', () => {
    // Act & Assert — Date.UTC would silently normalize all of these to a
    // different calendar day (and years 0–99 to 1900–1999).
    expect(() => calendarDayUtcRange('2026-02-30', 'Asia/Tehran')).toThrow(/Invalid local date/);
    expect(() => calendarDayUtcRange('2026-13-01', 'Asia/Tehran')).toThrow(/Invalid local date/);
    expect(() => calendarDayUtcRange('2026-00-10', 'Asia/Tehran')).toThrow(/Invalid local date/);
    expect(() => calendarDayUtcRange('0050-01-01', 'Asia/Tehran')).toThrow(/Invalid local date/);
  });

  it('never mutates the instant when converting it for display', () => {
    // Arrange — a stored absolute instant (UTC midnight).
    const instant = new Date('2026-11-15T00:00:00.000Z');
    const before = instant.getTime();

    // Act — the documented presentation-boundary pattern (ADR-030).
    const displayed = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Tehran',
      dateStyle: 'full',
      timeStyle: 'long',
    }).format(instant);

    // Assert — formatting reads the instant; it never rewrites it.
    expect(instant.getTime()).toBe(before);
    expect(displayed).toContain('2026');
  });
});
