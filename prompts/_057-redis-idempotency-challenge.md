# _057 — Redis-Backed Idempotency for the Enrollment Challenge (Phase 1)

## Original Request

Master prompt (provided by the developer, pasted into the session): implement
Phase 1 of the Idempotency initiative for `POST /enrollments/challenge` using
the official `@nestjs/idempotency` package and the existing Redis
infrastructure. Integrate the package, implement a Redis-backed
`IdempotencyStore`, apply idempotency to the challenge endpoint with a
phone-based HMAC-SHA256 scope, ensure retries and in-flight duplicates bypass
the application's rate limiter without consuming quota, change the endpoint
response to an empty `202 Accepted`, document the architectural decision in an
ADR, and record Phase 2 (idempotency across the external SMS provider
boundary) in `DEFERRED.md` without implementing it. The prompt mandated a
repository/document inspection phase, an explicit approval gate before any
file modification, and a structured final report.

## Approval Gate

The implementation proposal (eleven sections: findings, rate-limiter change,
module registration, store + key format, scope/fingerprint design, secret
handling, `storeIf`, ordering, tests, ADR/DEFERRED, risks) was presented and
the developer replied "approved". Per the ADR-first workflow, **ADR-039 was
the first repository write** (`DECISIONS.md`, Accepted), followed by the
implementation.

## Implementation

- **Dependency:** `@nestjs/idempotency@0.0.4` (pre-installed on the branch by
  the developer with a smoke-test spike; the spike on `AppController.getHello`
  was reverted and the formatting restored).
- **Store:** `RedisIdempotencyStore`
  (`apps/api/src/shared/idempotency/redis-idempotency.store.ts`) implements
  the four-method `IdempotencyStore` contract as one atomic Lua script per
  operation, registered on the shared client via ioredis `defineCommand`
  (typed through a `declare module 'ioredis'` augmentation) after a Mimosa
  pre-tool-use gate rejected the raw per-call script-execution pattern.
  Records are hashes (`state`/`fp`/`owner`/`resp`) with whole-record
  `PEXPIRE`; `acquire` creates/takes over/reports atomically, and
  `complete`/`release`/`extend` are owner-fenced compare-and-sets. Unreadable
  completed records fail closed. Reply narrowing is strict (non-contract
  replies and durations throw).
- **Keys:** `neo-bank:idempotency:store:record:<sha256hex>` over the package's
  `scope:key` (co-located `idempotency.keys.ts`). No plain phone, no
  client-controlled content.
- **Scope/fingerprint:** `enrollments.idempotency.ts` builds the
  `@Idempotent()` options: scope = `HMAC-SHA256(IDEMPOTENCY_SCOPE_SECRET,
  toNationalMobile(rawPhone))`, fingerprint = the normalized phone,
  `storeIf = status < 500 && status !== 429`. `toNationalMobile` was exported
  from `enrollments.schema.ts` (single normalization implementation,
  semantics unchanged).
- **Rate-limit defer (ADR-015 amendment, this route only):** `@DeferredRateLimit()`
  marks the route; `DeferredRateLimitGuard` (new `APP_GUARD` subclass of the
  unchanged `RedisThrottlerGuard`) skips deferred routes; a route-level
  `ChallengeRateLimitInterceptor` delegates to the official
  `ThrottlerGuard.canActivate` of a `RedisThrottlerGuard` provider inside the
  idempotency gate. Same storage instance, keys, quotas (short 2/120 s route
  override + long global), headers, and exception mapping; zero algorithm
  duplication.
- **Endpoint:** `202 Accepted` with an empty body (`@HttpCode`, handler
  returns `void`); Swagger documents the required `Idempotency-Key` header and
  202/400/409/422/429/500.
- **Errors:** `ErrorCode.IdempotencyKey{Required,Invalid,InUse,Reused}` and
  `ErrorCode.IdempotencyRecordUnreadable` carry the package's code strings;
  the Problem Details filter maps them with localized en/fa titles and
  details; replayed stored application errors keep their original `ErrorCode`
  (code-carry-through narrowing) so replays match the original execution.
- **Env:** `IDEMPOTENCY_SCOPE_SECRET` (required, 64 hex, `openssl rand -hex
  32`) in `env/schema/idempotency.env.ts` + `idempotency.config.ts`, synced
  into `.env.example` and all five local env files.
- **CORS:** `exposedHeaders: ['Idempotent-Replayed', 'Retry-After']` when
  CORS is enabled (production bootstrap + e2e mirror); `allowedHeaders` left
  to the echo behavior, pinned by an e2e preflight test.
- **Deployment prerequisite:** `maxmemory-policy noeviction` documented in
  `docs/docker.md`, `ONBOARDING.md`, `current-state.md`, ADR-039.

## Key Decisions

- ADR-039 (Accepted, first write): scope decision, key format, defer
  mechanism, storeIf, empty-202 contract, TTLs (24 h/60 s/1 s as named
  constants), fail-closed policy, CORS, rotation rule.
- Interceptor nesting verified against `@nestjs/core`'s scanner after the
  code-reviewer found the ADR's initial description inverted: the envelope and
  conditional-request interceptors register OUTSIDE the idempotency
  interceptor (root-module `APP_INTERCEPTOR`s first), which is what keeps
  stored bodies the raw handler result. The package's startup warning listing
  them is expected and benign; ADR-039 was corrected in place.
- 422 key-reuse is structurally unreachable on this endpoint by design
  (scope and fingerprint both derive from the same normalized phone); it
  stays documented as Swagger contract and defense in depth.
- Code-reviewer findings CR-01..CR-05 processed through
  `docs/judge-findings.md` Wave 28 and remediated (replayed-error code
  carry-through, `IDEMPOTENCY_RECORD_UNREADABLE` mapping with localized
  detail, ADR nesting correction, shared `isRecord`, scenario-G note).

## Validation (all executed, 2026-11-20)

- Unit: 54 files / 500 tests green.
- Redis tier: 6 files / 89 tests green — official `idempotencyStoreContract`
  with 16-caller concurrency races, expiry/takeover/fencing, bodyless-202
  round trip, record-state cases, Toxiproxy black-hole (bounded failure +
  recovery).
- E2E: 17 files / 115 tests green — scenarios A–J + CORS preflight + store
  failure 500 + store-selection diagnostic
  (`IdempotencyStorage: RedisIdempotencyStore`).
- Typecheck, build, lint (0 errors; 57 pre-existing warnings, none in new
  files) green.
- e2e tier now runs with `fileParallelism: false` (shared-container key-state
  assertions require sequential files; documented in the config and
  PROJECT_CONTEXT).
- Gates: code-reviewer CHANGES_REQUIRED → remediated → re-review;
  documentation-writer completed the documentation set in parallel (this
  file, DEFERRED.md, current-state, api.md, architecture.md one-liner,
  AGENTS.md, ONBOARDING.md, PROJECT_CONTEXT.md, docker.md addition by the
  primary agent).

## Deferred

- Phase 2 — Idempotency Across the External SMS Provider Boundary
  (`DEFERRED.md`): the ambiguous external side-effect outcome (SMS sent →
  response lost → retry → duplicate SMS/charges), provider-side idempotency
  investigation, durable delivery-state + reconciliation requirements, and
  the note that a Transactional Outbox alone does not guarantee exactly-once
  delivery across the boundary.

No commit was created (not requested).
