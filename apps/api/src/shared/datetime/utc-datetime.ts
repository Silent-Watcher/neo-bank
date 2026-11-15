/**
 * UTC boundary math for user-local calendar days (ADR-030). A calendar day in
 * an IANA zone is not always 24 hours — DST transitions shrink or stretch it —
 * so boundaries are derived from the zone's actual offsets via
 * `Intl.DateTimeFormat`, never fixed hour math. No date-time dependency: the
 * platform provides everything.
 */

// en-US + numeric parts give stable machine-readable output regardless of the
// host locale; `hourCycle: 'h23'` guarantees midnight is `00`, never `24`.
const WALL_CLOCK_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function wallClockFormatter(timeZone: string): Intl.DateTimeFormat {
  // Canonicalize before caching (SEC-01): IANA identifiers match
  // case-insensitively, so raw variants ("ASIA/TEHRAN") would grow this map
  // by one ICU-backed entry per case permutation with no eviction. Every
  // variant resolves to the canonical zone name, collapsing them to one
  // cache entry; invalid identifiers throw here — before any caching. The
  // transient lookup formatter allocates no pattern and is negligible per
  // call.
  const canonical = new Intl.DateTimeFormat('en', { timeZone }).resolvedOptions().timeZone;
  let formatter = WALL_CLOCK_FORMATTER_CACHE.get(canonical);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: canonical,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    WALL_CLOCK_FORMATTER_CACHE.set(canonical, formatter);
  }
  return formatter;
}

/** Offset (ms) of `timeZone` at `instant`: wall-clock-as-UTC minus instant. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = wallClockFormatter(timeZone).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);
  const wallAsUtc = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
    value('second'),
  );
  return wallAsUtc - instant.getTime();
}

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseLocalDate(localDate: string): { year: number; month: number; day: number } {
  if (!LOCAL_DATE_PATTERN.test(localDate)) {
    throw new Error(`Invalid local date: ${localDate}`);
  }
  const [year, month, day] = localDate.split('-').map(Number);
  // `Date.UTC` silently maps years 0–99 to 1900–1999 and normalizes rollover
  // components ('2026-02-30' → 2026-03-02), which would silently target the
  // wrong calendar day — reject both instead.
  if (year < 100) {
    throw new Error(`Invalid local date: ${localDate}`);
  }
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day
  ) {
    throw new Error(`Invalid local date: ${localDate}`);
  }
  return { year, month, day };
}

function nextLocalDay(localDate: string): string {
  const { year, month, day } = parseLocalDate(localDate);
  // Date.UTC rolls over month and year boundaries on its own.
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/**
 * The instant whose wall clock in `timeZone` is `00:00:00.000` of `localDate`,
 * solved by iterating the zone offset to a fixed point (usually one pass).
 * When a DST transition removes local midnight, the result is the first
 * instant the local day exists — the transition instant itself.
 */
function startOfLocalDayUtc(localDate: string, timeZone: string): Date {
  const { year, month, day } = parseLocalDate(localDate);
  const guess = Date.UTC(year, month - 1, day);
  let instant = guess;
  // Two offset refinements cover every real zone transition. A skipped local
  // midnight has no fixed point at all: the candidates oscillate across the
  // transition (e.g. America/Santiago 2024-09-08, 04:00Z ↔ 03:00Z), and the
  // final refinement is the transition instant itself — the first instant the
  // local day exists.
  for (let pass = 0; pass < 3; pass++) {
    const offset = zoneOffsetMs(new Date(instant), timeZone);
    const refined = guess - offset;
    if (refined === instant) {
      return new Date(instant);
    }
    instant = refined;
  }
  // Post-cap guard: only a skipped midnight may land here, and its final
  // candidate is the zone transition — the offset must change at that exact
  // millisecond. Anything else means the math failed; fail loudly instead of
  // returning a silently wrong boundary.
  const boundary = new Date(instant);
  const offsetAtBoundary = zoneOffsetMs(boundary, timeZone);
  const offsetJustBefore = zoneOffsetMs(new Date(instant - 1), timeZone);
  if (offsetAtBoundary === offsetJustBefore) {
    throw new Error(`Failed to resolve the start of ${localDate} in ${timeZone}`);
  }
  return boundary;
}

export interface UtcDayRange {
  /** Inclusive UTC start of the local calendar day. */
  readonly startUtc: Date;
  /** Exclusive UTC end of the local calendar day (start of the next one). */
  readonly endUtc: Date;
}

/**
 * Computes the UTC instants of the start and end of the calendar day
 * `localDate` (`YYYY-MM-DD`) in `timeZone` (IANA identifier). Use these
 * boundaries for database range queries — never subtract or add fixed hours
 * (ADR-030).
 */
export function calendarDayUtcRange(localDate: string, timeZone: string): UtcDayRange {
  const startUtc = startOfLocalDayUtc(localDate, timeZone);
  const endUtc = startOfLocalDayUtc(nextLocalDay(localDate), timeZone);
  return { startUtc, endUtc };
}
