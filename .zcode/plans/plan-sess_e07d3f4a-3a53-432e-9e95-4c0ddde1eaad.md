## Context — verified failure modes (installed ioredis 6.0.0, read directly)

The Redis side is **already well-protected at the caller boundary**: every command settles ≤ `commandTimeout` (5000 ms; armed per command at `Redis.js:368-370`, `Command.js:203-211`), `enableOfflineQueue: false` rejects disconnected-state commands immediately (`Redis.js:404-408`), `autoResendUnfulfilledCommands: false` + no application-level retries mean **no unsafe duplicate execution** (verified: enrollments and throttler call sites have no catch-retry), reconnection uses capped exponential backoff + jitter, shutdown is solid (status-based quit/disconnect, 2 s race, unref'd timer, idempotent, `disconnect()` clears a pending reconnect timer).

The verified residual black-hole exposure — the equivalent of the PostgreSQL vulnerability, and worse in one respect:

1. **`commandTimeout` is rejection-only.** On expiry it rejects the caller's promise ("Command timed out") but **does not remove the command from the FIFO `commandQueue`, does not touch the socket, and leaves `status === "ready"`** (`Command.js:203-211`; queue mutations verified — nothing drains it except replies/close).
2. **Under a black hole the `commandQueue` grows unboundedly.** Written commands are pushed (`Redis.js:449`, an uncapped denque) and only replies shift them. With packets silently dropped, every request's PING/OTP/throttle command adds a permanent entry — memory grows at the full request rate for as long as the dead epoch lasts.
3. **The dead epoch is long.** Nothing detects the silent socket: TCP keepalive is on by default (`keepAlive: 30000`, verified — contrary to older-ioredis assumptions) but Linux defaults make detection ≈ 30 s + 9×75 s ≈ **11–12 minutes**. Meanwhile every new command pays the full 5 s (no fast-fail), and `/health`/`/health/ready` (guard-exempt) amplify 1:1 into 5-second Redis commands — HTTP pileup plus the queue growth above.
4. **ioredis ships exactly one built-in that proactively kills such a socket — `socketTimeout`** (`Redis.js:516-531`): armed when a command is written, destroys the stream after N ms of received-data silence, which triggers `closeHandler` → bounded `retryStrategy` reconnect → with the offline queue disabled, all commands during reconnection fail **fast**. It is not configured today (default: absent/disabled).
5. **Health probes are not coalesced** (SEC-INFO-01 deferred from _053): every flood request runs its own PING; a probe can also take the full 5 s `commandTimeout`, which collides with the 5 s Compose healthcheck timeout (the same nesting hazard the DB probe fixed with 3 s < 5 s).

The master prompt's two-phase workflow: this is the Phase 1 proposal — no project files modified yet; implementation starts only after approval.

## Design

**1. Black-hole recovery via `socketTimeout` (the core fix).** Configure `socketTimeout: REDIS_SOCKET_TIMEOUT_MS` (new optional env var, default **6000** = `commandTimeout` 5000 + 1 s margin so commands reject first, then the socket dies). Semantics verified: armed when a command is written; destroyed after 6 s of received-data silence **only while commands are in flight** (cleared/re-armed on each data chunk; idle connections are unaffected); destruction → `closeHandler` → bounded reconnect (`200 ms→2 s→30 s` cap + jitter) → during `"close"`/`"reconnecting"` every command fails **immediately** (`"Stream isn't writeable and enableOfflineQueue options is false"`). Net effect: a black-holed epoch is bounded to ~6 s of slow commands, the `commandQueue` residue is flushed/dropped on close (entries' promises already settled at 5 s — no caller ever hangs), and recovery is automatic. Keepalive (explicitly set, see below) remains the safety net for _idle_ connections; its ~11–12 min Linux detection window is documented as a limitation.

**2. Explicit options (no undocumented defaults).** In `redis-options.ts`: add `socketTimeout` (above), `enableReadyCheck: true`, and `keepAlive: 30000` explicitly with comments stating the verified semantics and the OS-level keepalive limitation (detects dead peers on idle connections only after minutes; cannot detect black-holed in-flight traffic).

**3. Coalesced Redis health probe (SEC-INFO-01 + master §6).** New `RedisHealthProbe` provider (`src/shared/redis/redis.probe.ts`) mirroring `DatabaseHealthProbe` (ADR-036): single-flight over `RedisService.ping()`, process-local TTL cache (**5 s success / 3 s failure cooldown** — same values as the DB probe; matches the 10 s/15 s Compose API healthcheck cadence), and a **3 s probe deadline** (`REDIS_HEALTH_PROBE_TIMEOUT_MS`) so worst-case liveness latency stays below the 5 s Compose timeout and below `commandTimeout`. The deadline race is non-cancelling by the same accepted ADR-036 semantics: the losing PING settles via `commandTimeout` (5 s) and its queue residue is bounded by `socketTimeout` (6 s). The indicator (`redis.health.ts`) delegates to the probe; liveness degraded-200 / readiness down-503 contracts, guard exemptions, and `Cache-Control: no-store` (already in place from _053) are unchanged.

**4. No circuit breaker — justified skip.** With `socketTimeout`, the slow-window per black-hole epoch is ~6 s; genuine unavailability already fails fast (offline queue disabled during reconnect); ioredis' own status lifecycle plus the coalesced probe provide the probing/recovery behavior a breaker would duplicate. A breaker would add a state machine (half-open probing, abandonment edges) with no failure mode it fixes that the above doesn't. Documented in the ADR as a considered alternative.

**5. Idempotency posture (verified, documented — no code change).** No application-level retries exist anywhere; `autoResendUnfulfilledCommands: false` prevents resend-on-reconnect; `commandTimeout` rejections are ambiguous-outcome (the command may have executed server-side) and are **never re-executed**. Per-command semantics documented in the ADR: `SET NX EX` (issueOtp) is overwrite-safe, the rate-limit `ZADD` uses a random member (replay would double-count — never retried), `INCR` attempts — never retried.

**6. Shutdown & connection budget (verified, documented — no code change).** Shutdown handles `wait/connecting/reconnecting` via immediate `disconnect()` and `ready` via bounded `quit()` (verified idempotent and reconnect-timer-clearing). Connection budget: exactly **one client per API instance**, shared by enrollments, throttler, and health (a dedicated probe client is unjustified — PING is trivial and sharing keeps the budget at 1×replicas); no pub/sub, no BullMQ, no blocking commands, no duplicate clients (verified by grep).

## Timeout hierarchy

Probe deadline 3000 < `commandTimeout` 5000 < `socketTimeout` 6000 < keepalive dead-peer detection (~11–12 min, idle only) ≤ Compose API healthcheck timeout 5000 for the HTTP boundary (liveness worst case ~3 s fits). All explicit; nothing left to library defaults.

## Files

**Added:** `apps/api/src/shared/redis/redis.probe.ts` (`RedisHealthProbe`: single-flight, TTL cache, 3 s deadline race — mirrors `database.probe.ts`); `apps/api/src/shared/redis/redis.probe.spec.ts`; `apps/api/test/redis-black-hole.redis-spec.ts` (below); `prompts/_054-*.md`.
**Modified:** `redis.health.ts` (delegate to probe); `redis.module.ts` (register probe); `redis-options.ts` (`socketTimeout`, `enableReadyCheck: true`, `keepAlive` explicit); `redis.env.ts` (+spec) and `redis.config.ts` (`REDIS_SOCKET_TIMEOUT_MS`, `positiveSafeInteger` + the correct blank-tolerant `z.preprocess` pattern from the start — per the CR-05 lesson); `apps/api/env/.env.example` / `.env.development` / `.env.production` (`REDIS_SOCKET_TIMEOUT_MS=6000`; test env files omit optional-with-default vars, as established); `apps/api/ONBOARDING.md` (env row); `apps/api/test/testcontainers.ts` (`TestRedis` gains the same optional shared-network/alias options `TestPostgres` already has); `DECISIONS.md` (**ADR-037** — the first repository write after approval), `docs/current-state.md`, `DEFERRED.md` (mark SEC-INFO-01 done via this task), `docs/ai-decisions.md`, `docs/judge-findings.md` (Wave 24 after gates).

**Explicitly out of scope (per §13 and the deferred registry):** the CR-05 blank-value siblings (`BODY_LIMIT`, the four existing `REDIS_*_MS` vars) stay deferred; no PostgreSQL changes; no new dependencies; no `RedisService` command-semantics changes; no commits.

## Tests

**Unit (`redis.probe.spec.ts`, fake timers, mirrors `database.probe.spec.ts`):** burst of N probes → one `ping`; success-TTL reuse/expiry; failure cooldown then recovery; deadline path (never-settling ping → bounded `ok:false` at 3 s; late-settling loser absorbed — per the race-loser lesson, both "never settles" and "settles late" cases); non-Error rejection; concurrent liveness+readiness share one probe.
**Redis tier (`redis-black-hole.redis-spec.ts`, real Redis + Toxiproxy on a shared network, short test timeouts e.g. `commandTimeout` 1500 / `socketTimeout` 2500):**

1. PING succeeds through the proxy (established connection).
2. Black-hole toxics both directions → PING rejects ≤ `commandTimeout` with "Command timed out"; `client.status` **stays `"ready"`** (documents the verified ioredis behavior).
3. Within ~`socketTimeout` the socket is destroyed → status leaves `"ready"` → subsequent commands fail **fast** (< ~300 ms, stream-not-writeable) — no 5 s pileup.
4. Toxics removed → client reaches `"ready"` → PING succeeds (recovery without restart).
5. No-duplicate-execution: `INCR` before the fault; an `INCR` issued into the black hole (ambiguous outcome); after recovery, server-side value − pre-fault value ∈ {0, 1} — never 2 (no resend/no blind retry).
6. Explicitly does **not** probe private internals (no `commandQueue` inspection) — behavioral assertions only.
   **Regression (must pass unchanged):** the 4 existing redis-tier specs (60 tests), `redis-health.e2e-spec.ts`, `enrollments.e2e-spec.ts`, and the db/unit/e2e/redis tiers re-run in full.
   **Lifecycle:** existing `redis.service.spec.ts` shutdown coverage re-verified; add a shutdown-during-`reconnecting` case only if not already covered.

## ADR-037 (first write after approval)

"Bounded Redis Commands, Black-Hole Recovery, and Coalesced Redis Health Probes": the verified failure modes (rejection-only timeout, unbounded FIFO growth, 11–12 min dead epoch); why a JS Promise timeout alone is insufficient; offline queue vs in-flight queue; the `socketTimeout` strategy vs alternatives (circuit breaker — rejected with rationale; dedicated probe client — rejected, connection budget); keepalive reality check; retry/idempotency decisions; single-flight + TTL cache; shutdown; connection budget; known limitations (idle-connection detection window, ambiguous command outcomes, Toxiproxy-based test fidelity).

## Verification

1. `pnpm format`, `pnpm lint`, `pnpm typecheck` (apps/api).
2. All four tiers: `pnpm test` (unit), `pnpm test:redis` (incl. the new black-hole spec), `pnpm test:db`, `pnpm test:e2e` — Docker needed; Toxiproxy image already pulled locally.
3. Review gates per the AGENTS.md workflow: context-blind `code-reviewer` → then `code-security-analyzer`; every finding persisted in `docs/judge-findings.md` (Wave 24) and out-of-scope ones in `DEFERRED.md` — per the new "Subagent Findings" rules; documentation-writer in parallel with testing.
4. Zero-orphan check (Testcontainers/ryuk + no stray listeners), final diff review, report distinguishing caller rejection vs command abandonment vs connection destruction vs recovery.

No commits unless explicitly requested.
