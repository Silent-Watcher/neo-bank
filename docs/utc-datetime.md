# UTC-First Date and Time Handling

This document is the developer-facing guide to the API's UTC-first storage
policy ([ADR-030](../DECISIONS.md)): what it mandates, why, and how feature
code uses it. It accompanies the shared persistence base entity
([ADR-029](../DECISIONS.md)), whose timestamp columns (`createdAt`,
`updatedAt`, `deletedAt`) are the policy's first application.

## Storage policy: absolute instants in `timestamptz`

- Every application timestamp column uses PostgreSQL `timestamptz` with
  precision 3 (`timestamptz(3)`) wherever a JavaScript `Date` is the
  canonical representation. Precision 3 means millisecond resolution —
  exactly what `Date` carries, so higher precision is dead weight.
- `timestamptz` stores an **absolute instant** — a single point on the
  global timeline. That is what every business timestamp means (when a row
  was created, when an OTP expires, when an update happened), and it makes
  ordering, comparison, and range queries correct by construction.
- `timestamp` (without time zone) is never introduced: it stores a
  wall-clock reading with no anchor to the timeline and relies on every
  writer being perpetually correct.
- There is no local time in storage. Local time is a presentation concern
  (see below).

## PostgreSQL `timestamptz` behavior

- PostgreSQL stores `timestamptz` internally in UTC. **The original offset
  submitted with a value is not preserved** — only the instant is. This is
  by design: the absolute instant is the record of truth, and any offset a
  client sent is presentation metadata that never reaches storage.
- The session/server `TimeZone` setting affects only how values are
  rendered for output and how ambiguous input defaults are resolved; it
  never changes the stored instant. With the server pinned to UTC, stored
  values, logs, and driver round-trips are identical in every environment.

## MikroORM configuration

- `forceUtcTimezone: true` is set explicitly in
  `apps/api/src/shared/database/mikro-orm.options.ts` (ADR-030). It forces
  UTC serialization for timezone-less datetime columns; it does **not**
  replace the `timestamptz` column types, which store absolute instants
  regardless. The setting is also the installed default of MikroORM 7.2.9 —
  it is written out to document the policy, not to change behavior.
- Hydration path: the `pg` driver returns timestamp values as raw strings
  and the ORM parses them using the platform timezone (`Z`) into `Date`
  instances. The driver issues no session `SET TIME ZONE`, so the server's
  `TimeZone` setting governs.

## PostgreSQL server configuration (Docker)

- The dev and prod Compose stacks pin the `postgres` services to UTC with
  `TZ: UTC` (`docker/compose.app.dev.yml`, `docker/compose.app.prod.yml`).
  PostgreSQL's `initdb` derives the cluster's default `TimeZone` from the
  container timezone, so `SHOW TimeZone` returns UTC regardless of image or
  environment drift.
- The Testcontainers test image pins UTC the same way
  (`apps/api/test/testcontainers.ts`, `TestPostgres` sets `TZ: 'UTC'`), so
  integration tests behave exactly like the Compose stacks.
- The API container deliberately sets no `TZ`: a JavaScript `Date` is an
  absolute instant and Node's local zone must not influence persistence.

## JavaScript `Date` rules

A `Date` is an absolute instant — never a "local date". The rules:

- Treat `Date` values as instants and serialize them as ISO-8601 UTC
  (`toISOString()` produces the trailing `Z` form).
- Never construct database-bound values from local-time components —
  `new Date(year, monthIndex, day)` is the local-zone constructor. Derive
  UTC boundaries with `calendarDayUtcRange` or UTC-based constructors
  instead.
- Never store a fixed offset (`+03:30`) in place of a timezone identifier.
  An offset is not a timezone: DST transitions make a static offset wrong
  within the same zone during parts of the year.
- Never parse non-ISO strings with `Date.parse` (behavior is
  implementation-defined); use ISO-8601 input or validated `YYYY-MM-DD`
  strings with the boundary helper.

## User timezone conversion at the presentation boundary

Users live in arbitrary timezones (Persian-speaking users primarily in
`Asia/Tehran`, UTC+03:30). Conversion to a user's zone happens **outside
the persistence layer**, using IANA identifiers and the platform's
`Intl.DateTimeFormat` — no date library:

```ts
// Reads the instant; formatting never mutates it.
const displayed = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Tehran',
  dateStyle: 'full',
  timeStyle: 'long',
}).format(entity.createdAt);
```

- Use IANA identifiers (`Asia/Tehran`), never fixed offsets, as the
  `timeZone` value. Invalid identifiers throw from `Intl` — a deliberate
  fail-fast; validate zone input before it reaches this boundary.
- Formatting reads the instant and never rewrites it. Persisting a
  "converted" value is always wrong.

## UTC range queries with `calendarDayUtcRange`

`apps/api/src/shared/datetime/utc-datetime.ts` provides
`calendarDayUtcRange(localDate, timeZone)`: the exact UTC start and end
instants of a user-local calendar day, derived from the zone's actual
offsets via `Intl.DateTimeFormat` — never fixed hour math.

```ts
import { calendarDayUtcRange } from '#src/shared/datetime/utc-datetime.js';

const { startUtc, endUtc } = calendarDayUtcRange('2026-11-15', 'Asia/Tehran');
// startUtc → 2026-11-14T20:30:00.000Z  (00:00 in Tehran, UTC+03:30)
// endUtc   → 2026-11-15T20:30:00.000Z  (start of the next local day)

const rows = await em.find(Order, {
  createdAt: { $gte: startUtc, $lt: endUtc },
});
```

- `localDate` must be `YYYY-MM-DD`; `timeZone` must be a valid IANA
  identifier (invalid input throws — see the unit tests).
- The range is a half-open interval `[startUtc, endUtc)`: `startUtc` is
  inclusive, `endUtc` is exclusive (it is the start of the next local
  day). A record at exactly `endUtc` belongs to the next day, and no
  instant is counted twice.

## DST and calendar-boundary pitfalls

- A local calendar day is **not always 24 hours**: a DST spring-forward
  transition produces a 23-hour day, fall-back a 25-hour day.
  `calendarDayUtcRange` returns the true length; never assume fixed
  durations around transitions.
- When a DST transition removes local midnight (rare), the returned
  `startUtc` is the first instant the local day exists — the transition
  instant itself — and `endUtc` remains the start of the next day, so the
  half-open interval still covers the local day exactly once.

## Common mistakes

- Storing local wall-clock time as if it were UTC (e.g. taking local date
  parts and formatting them as UTC).
- Constructing database-bound values with the local
  `new Date(year, month, day)` constructor.
- Converting by adding or subtracting fixed hours (`+03:30`) instead of
  resolving IANA zone offsets.
- Using `Date.parse` on non-ISO strings.
- Assuming every day is 24 hours in range or bucketing logic.
- Storing an offset where a timezone identifier belongs.
- Introducing a `timestamp` (without time zone) column.

## How the policy is verified

- **Metadata tier** (`apps/api/src/shared/database/base.entity.spec.ts`):
  discovery-level assertions without a database — timestamp properties map
  to `timestamptz(3)` with the required nullability and lifecycle
  callbacks, alongside the rest of the BaseEntity shape (ADR-029).
- **Database tier** (`apps/api/test/base-entity.db-spec.ts`, run via
  `pnpm test:db` with Testcontainers): asserts `SHOW TimeZone` returns UTC
  in the test container, the physical column/constraint shape of a
  concrete table, that timestamps round-trip as absolute instants without
  shifts, entity lifecycle (`updatedAt`/`version` progression), actor
  attribution, and optimistic locking (stale expected version → HTTP 409).
- **Unit tier** (`apps/api/src/shared/datetime/utc-datetime.spec.ts`):
  Tehran UTC+03:30 day boundaries, 23-hour and 25-hour DST days
  (`America/New_York`), month/year rollover, rejection of malformed dates
  and unknown zones, and display formatting that never mutates the
  instant.
