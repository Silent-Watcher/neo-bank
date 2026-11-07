# Global Redis Rate Limiting

## User Request

The user asked to implement a production-ready, globally registered HTTP rate-limiting mechanism in the existing NestJS application using `@nestjs/throttler` with Redis as the shared storage backend. The application may run several backend instances simultaneously, so rate-limit counters must be shared across all instances using the same Redis infrastructure. The primary objective is a coarse-grained per-IP protection layer for the HTTP API.

## Implementation

- **Storage**: Custom `RedisThrottlerStorage` (`src/shared/throttler/redis-throttler.storage.ts`) implementing `@nestjs/throttler`'s `ThrottlerStorage` interface. Uses a single atomic Lua script (`INCREMENT_SCRIPT`) for all dependent operations (check block, read/increment counter, set expiration, apply block policy, compute all expirations). The script evaluates the block state BEFORE incrementing the counter, preventing the known nest-lab issue #74 flaw where a stale counter could rearm and block again after the advertised Retry-After.
- **Named policies**: Two global throttlers configured in `throttlerModule.forRootAsync()`:
  - `short`: 10 requests / 1 second (default, configurable via `RATE_LIMIT_SHORT_LIMIT` / `RATE_LIMIT_SHORT_TTL_SECONDS`)
  - `long`: 100 requests / 1 minute (default, configurable via `RATE_LIMIT_LONG_LIMIT` / `RATE_LIMIT_LONG_TTL_MINUTES`)
- **Global guard**: `RedisThrottlerGuard` (`src/shared/throttler/redis-throttler.guard.ts`) extends the official `ThrottlerGuard`, overriding `handleRequest` to set both the standard `Retry-After` header and named variants (`Retry-After-short`, `Retry-After-long`), plus `X-RateLimit-*` headers on both success (quota remaining) and 429 (quota 0) responses.
- **Health/readiness endpoints**: Explicitly skipped for both named policies via `@SkipThrottle({ short: true, long: true })` on `HealthController`.
- **Decorator support**: Method-level `@Throttle()` and `@SkipThrottle()` with named throttler objects work correctly. Bare `@SkipThrottle()` targets only the "default" name and leaves named policies active (tested).
- **Redis integration**: Reuses the existing `REDIS_CLIENT` from `RedisModule` — no second connection, lifecycle stays with the owning module. The storage never opens/closes connections.
- **Key namespace**: `neo-bank:throttler:rate-limit:hit:{<key>}` and `neo-bank:throttler:rate-limit:block:{<key>}` via `throttler.keys.ts`. The `{...}` hash tag around the key keeps hit/block keys in the same Redis Cluster hash slot.
- **Error handling**: `ThrottlerException` is caught specifically in `ProblemDetailsFilter` and mapped to `RATE_LIMITED` Problem Details (HTTP 429) with a safe message. Guard headers are preserved through the global exception filter.
- **Failure policy**: No in-memory fallback. Redis errors propagate as HTTP 500 (APPLICATION_ERROR), never as a fake 429. Bounded command timeouts and `enableOfflineQueue: false` ensure fast failure.
- **Trust proxy**: Uses Fastify's `request.ip` (respects `trustProxy` config). Does not manually parse `X-Forwarded-For`. IPv6 `/64` subnet grouping via the official tracker normalization. Spoofed headers from untrusted peers are ignored.
- **Environment variables**: Added to Zod schema in `src/shared/config/env/schema/rate-limit.env.ts` with positive integer validation and safe integer bounds.

## Validation

- `pnpm --filter @neo-bank/api typecheck` — passed.
- `pnpm --filter @neo-bank/api build` — passed.
- `pnpm --filter @neo-bank/api lint` — passed (only pre-existing warnings).
- `pnpm --filter @neo-bank/api format:check` — passed.
- `pnpm --filter @neo-bank/api test` — 196 unit tests passed.
- `pnpm --filter @neo-bank/api test:e2e` — 62 e2e tests passed.
- `pnpm --filter @neo-bank/api test:redis` — 32 Redis integration tests passed (counter window, blocking, block-duration regression for nest-lab #74, zero/negative block duration, atomicity under concurrency, key namespace, multi-instance sharing, Redis failure).

## Documentation

- Root `AGENTS.md`: Rate-limiting requirements and testing expectations referenced.
- `apps/api/AGENTS.md`: Added throttler module to shared infrastructure list, `test:redis` command.
- `apps/api/ONBOARDING.md`: New environment variables table, rate-limiting behavior, `test:redis` command.
- `docs/current-state.md`: Rate limiting added to implemented features with details.
- `docs/architecture.md`: Rate limiter noted as Redis consumer.
- `DECISIONS.md`: ADR-015 created.
- `apps/api/env/.env.example`: Rate-limit variables added with comments.

## Third-Party Evaluation

The community provider `@nest-lab/throttler-storage-redis` was evaluated and rejected because:

1. Unfixed nest-lab issue #74 (active block can be extended by requests during block).
2. Issue #55 (invalid `SET ... PX 0` for zero block duration).
3. Issue #52 (repeated `EVAL` without script caching for `EVALSHA`).
4. Does not demonstrably support reusing an existing Redis connection without lifecycle conflicts.

The custom storage is ~140 lines of production code (well under the 200-line threshold), fully tested, and avoids an unnecessary dependency with known correctness bugs.
