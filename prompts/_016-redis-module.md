# Redis Module

## User Request

The user asked for a production-ready Redis integration inside the `apps/api`
NestJS application: a dedicated global `RedisModule` using ioredis directly
(no third-party NestJS Redis wrapper), a `RedisService` abstraction, an
`InjectRedis()` escape hatch, configuration through the existing Zod env
layer, resilient connection management that never blocks startup, graceful
shutdown through the NestJS lifecycle, degraded-mode Terminus health checks,
full test coverage, two ADRs, and persistent rules in the AGENTS.md files.

## Implementation

- **Module** (`src/shared/redis/`): `RedisModule` is `@Global()`, registered
  once in `AppModule`, imports `TerminusModule` for `HealthIndicatorService`,
  and exports `REDIS_CLIENT`, `RedisService`, and `RedisHealthIndicator`.
  The ioredis client is provided by `redisClientProvider` under a `Symbol`
  token (`redis.constants.ts`); `createRedisClient` builds it from the
  validated `REDIS_CONFIG` namespace.
- **Abstraction**: `RedisService` — get, set (with `EX` TTL), `UNLINK`
  deletion, exists, expire, ttl, atomic increment/decrement via `INCRBY`,
  bounded `scanKeys` (SCAN, never KEYS), and a PING probe. It owns the
  lifecycle: `onModuleInit` initiates the connection without awaiting it and
  attaches the event listeners exactly once (connect/ready/error/close/
  reconnecting/end, with error-message dedupe to avoid log flooding and
  recovery logging after outages); `onApplicationShutdown` removes listeners,
  QUITs gracefully with a bounded timeout, and falls back to `disconnect()`.
  Idempotent via a completion flag.
- **Resilience** (`redis-options.ts`): `lazyConnect`, `connectTimeout`,
  `commandTimeout`, finite `maxRetriesPerRequest`, `enableOfflineQueue: false`
  (fail-fast, no unbounded queue), `autoResendUnfulfilledCommands: false` (no
  replay of non-idempotent commands), and a capped exponential backoff
  (200 ms → 30 s) with jitter that retries indefinitely so Redis recovery
  needs no restart.
- **Health**: `RedisHealthIndicator` pings the shared client (no extra
  connections, bounded by `commandTimeout`) and reports `degraded` on
  failure — verified against Terminus 12, whose executor treats degraded as
  non-fatal (overall status `degraded`, HTTP stays 200; `down` would 503).
  The health controller always includes the Redis indicator.
- **Configuration**: `redis.env.ts` schema + `redis.config.ts` factory
  (`REDIS_CONFIG` symbol) wired into `env.config.ts`/`config.ts`;
  `.env.example` documents every variable.

### Decisions

- ioredis 6.0.0 is the only new dependency (per request).
- **User correction (mid-task):** `REDIS_URL`, `REDIS_USERNAME`, and
  `REDIS_PASSWORD` are mandatory configuration (validated, trimmed), not
  optional. The originally planned "deliberately unconfigured" state (null
  client, omitted health indicator) was removed. Redis _server_ unavailability
  remains a runtime condition: startup still never blocks and `/health`
  degrades with HTTP 200. Empty username/password are omitted from client
  options so no empty AUTH is attempted on no-auth servers.
- `REDIS_URL` accepts only `redis://` or `rediss://` schemes.
- `REDIS_DB` is optional (0–15); TLS forced via `REDIS_TLS` or `rediss://`.
- `UNLINK` requires Redis server ≥ 4.0 — documented as a deployment
  requirement (no silent `DEL` fallback).

## Documentation

- `DECISIONS.md`: ADR-012 (ioredis without a wrapper) and ADR-013 (global
  module + abstraction), both **Pending**.
- Root `AGENTS.md`: new "External Service Integrations" section (dependency
  evaluation, non-blocking startup, lifecycle ownership, bounded timeouts,
  honest degradation).
- `apps/api/AGENTS.md`: Redis architecture bullet, "Redis Rules" section
  (`RedisService` first, escape-hatch policy, UNLINK/SCAN, no wrapper
  sprawl, test strategy), symbol-token rule, directory structure.
- `apps/api/ONBOARDING.md`: ioredis in the stack table, Redis prerequisites,
  full env variable table, `shared/redis/` in the structure, usage notes.
- `docs/current-state.md` and `docs/architecture.md`: Redis integration
  status, validated variables, ADR list, infrastructure section.
- `env/.env.example` and local `env/.env.development` / `.env.test` (test
  points at an unreachable address on purpose, exercising the degraded path).

## Validation

- `pnpm typecheck`, `pnpm test` (unit), and `pnpm test:e2e` were run during
  implementation; remaining failures were fixed iteratively (module export
  of the client token, env-module mocks for specs that load the config chain,
  Terminus degraded aggregation).
- The user then fixed the remaining test issues and personally ran format,
  lint, and typecheck; final check results are therefore user-verified, not
  re-run by the agent. Committed by the user as `feat: added redis module`
  (6124fc1) and the enrollments merge `6594165` that also fixed the e2e
  health tests and the `#modules/` alias map.
