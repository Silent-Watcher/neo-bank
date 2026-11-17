# _054 — Redis Reliability, Black-Hole Resilience & DoS Protection

- **Date:** 2026-11-17
- **Status:** Implemented. Code review gate: iteration 1 APPROVED_WITH_SUGGESTIONS (2 Low findings applied) → iteration 2 APPROVED_WITH_SUGGESTIONS (fixes verified; 1 trivial residual applied). Security gate: SECURITY_APPROVED_WITH_INFORMATIONAL_FINDINGS (SEC-01 applied — frozen probe outcomes in both probes; SEC-02/03 accepted documented residuals; SEC-04 deferred). See `docs/judge-findings.md` Wave 24.

## Original Request (condensed)

Master prompt (user paste, 2026-11-17): "Redis Reliability, Black-Hole Resilience, and DoS Protection" — audit the Redis integration for failure modes analogous to (or worse than) the PostgreSQL connection-exhaustion vulnerability and eliminate the verified risks: established-connection black holes, command timeout vs cancellation semantics, offline/in-flight queue behavior, reconnect and retry policy, health-check request amplification (single-flight + TTL cache), explicit configuration, connection budgeting, graceful shutdown, fault-injection tests, and an ADR. Mandatory two-phase workflow: read-only investigation + proposal first; explicit approval before implementation; no commits unless requested. The Phase 1 proposal was produced in plan mode and approved by the developer. Full original text preserved in the session history.

## Investigation Findings (Phase 1, ioredis 6.0.0 sources read directly)

- **Caller boundary already bounded:** every command settles ≤ `commandTimeout` (5000 ms, armed per command at `Redis.js:368-370`); `enableOfflineQueue: false` rejects non-writable-state commands immediately (`Redis.js:404-408`); `autoResendUnfulfilledCommands: false` + zero application-level retries → no unsafe duplicate execution; capped backoff reconnection; shutdown complete and idempotent.
- **Verified gaps (the equivalent-or-worse failure modes):**
  1. `commandTimeout` is **rejection-only** — the command stays in the FIFO `commandQueue` (nothing drains it except replies/close), the socket is untouched, and `client.status` stays `"ready"`.
  2. **Unbounded in-flight accumulation** during a black hole (queue grows one entry per command; denque has no cap).
  3. **The dead epoch is ~11–12 minutes** — keepalive is ON by default in ioredis 6 (`keepAlive: 30000`, verified, contrary to older assumptions) but Linux probe defaults detect a silent peer in minutes; meanwhile every command pays the full 5 s and the guard-exempt health routes amplify 1:1.
  4. **`socketTimeout`** (`Redis.js:516-531`) is the only built-in that proactively destroys a silent in-flight socket — not configured.
  5. The Redis health indicator ran one PING per request (no coalescing) and a probe could take the full 5 s — colliding with the 5 s Compose healthcheck timeout.
- No pub/sub, BullMQ, blocking commands, or duplicate clients exist anywhere (verified); connection budget = 1 client × replicas.

## Implementation

| File                                                                            | Change                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DECISIONS.md`                                                                  | **ADR-037** accepted (first repo write; user-approved proposal): bounded Redis commands, black-hole recovery, coalesced Redis health probes                                                                                              |
| `apps/api/src/shared/redis/redis.probe.ts`                                      | **New** `RedisHealthProbe`: single-flight over PING, process-local cache (5 s success / 3 s failure cooldown), 3 s probe deadline (`Promise.race`; the losing PING settles via `commandTimeout`, its residue bounded by `socketTimeout`) |
| `apps/api/src/shared/redis/redis.health.ts`                                     | Indicator delegates to the probe; degraded-200 / down-503 contracts and SEC-01 generic messages preserved; per-probe (not per-request) logging                                                                                           |
| `apps/api/src/shared/redis/redis.module.ts`                                     | Probe registered before the indicator it serves                                                                                                                                                                                          |
| `apps/api/src/shared/redis/redis-options.ts`                                    | `socketTimeout` (from env), explicit `enableReadyCheck: true` and `keepAlive: 30000` with verified-semantics comments                                                                                                                    |
| `apps/api/src/shared/config/env/schema/redis.env.ts` (+spec), `redis.config.ts` | New optional `REDIS_SOCKET_TIMEOUT_MS` (default 6000; blank-tolerant `z.preprocess` from day one — per ai-decisions #25)                                                                                                                 |
| `apps/api/env/.env.example`, `.env.development`, `.env.production`              | `REDIS_SOCKET_TIMEOUT_MS` documented (6000); test env files omit optional-with-default vars                                                                                                                                              |
| `apps/api/ONBOARDING.md`                                                        | Env-table row                                                                                                                                                                                                                            |
| `apps/api/test/testcontainers.ts`                                               | `TestRedis.start` gains optional shared-network/alias options (mirror of `TestPostgres`)                                                                                                                                                 |
| `apps/api/test/redis-black-hole.redis-spec.ts`                                  | **New** redis-tier fault-injection suite (details below)                                                                                                                                                                                 |
| `apps/api/src/shared/redis/redis.probe.spec.ts`                                 | **New** unit spec: single-flight burst, TTL reuse/expiry, failure cooldown + recovery, deadline paths (never-settling AND late-settling PING), non-Error rejection                                                                       |
| `apps/api/src/shared/redis/redis.health.spec.ts`                                | Reworked to mock the probe engine; up/degraded/down mapping and SEC-01 assertions kept                                                                                                                                                   |
| `docs/current-state.md`, `DEFERRED.md`, `docs/ai-decisions.md`                  | Synced; SEC-INFO-01 marked **Done**                                                                                                                                                                                                      |

Timeout hierarchy (ADR-037): probe deadline 3000 < `commandTimeout` 5000 < `socketTimeout` 6000 < keepalive dead-peer detection (~11–12 min, idle only) ≤ Compose API healthcheck timeout 5000 (liveness worst case ~3 s fits).

## Black-hole fault-injection suite (`test/redis-black-hole.redis-spec.ts`)

Real Redis + Toxiproxy on a shared container network; short test deadlines (command 1500 ms / socket 2500 ms) preserving the production ordering. Behavioral assertions only — no private ioredis internals:

1. Commands succeed through the proxy before the fault (plus the counter baseline).
2. Black-hole toxics on both streams → PING rejects at ~`commandTimeout` with "Command timed out" while `client.status` **stays `"ready"`** (documents the verified rejection-only semantics). A state-changing INCR written in this window has a genuinely ambiguous outcome (captured, never replayed).
3. Within `socketTimeout` the silent socket is destroyed → status leaves `"ready"` → commands issued while reconnecting fail **immediately** (`"Stream isn't writeable..."` < 500 ms) — no pileup.
4. Toxics removed → client reaches `"ready"` without restart → the ambiguous INCR is proven to have been rejected exactly once (never replayed) and to have executed **at most once** server-side (0 or 1 — never 2) → PING succeeds.
5. A second client whose handshake cannot complete rejects its first command immediately instead of offline-queueing.

## Review Gate Findings (docs/judge-findings.md, Wave 24)

Context-blind code review iteration 1: **APPROVED_WITH_SUGGESTIONS** — the reviewer re-verified every load-bearing ioredis claim against the installed sources and found the probe state machine and the integration timing chain sound; 2 Low findings, both applied in iteration 1: CR-01 (the blank-convention comment contradicted the schema's siblings → shared `positiveIntegerEnv` helper applied to all five Redis numeric fields, closing the Redis portion of deferred CR-05) and CR-02 (missing cross-field rule → `isRedisSocketTimeoutInvalid` wired into the `envSchema.superRefine`, with valid/equal/inverted spec cases). Iteration 2 verified both fixes and surfaced one trivial residual (unused import — removed). Security gate: **SECURITY_APPROVED_WITH_INFORMATIONAL_FINDINGS** — SEC-01 (CWE-471, mutable-by-convention shared outcome objects → `Object.freeze` applied to both the Redis and the PostgreSQL probe), SEC-02 (latency fingerprinting — accepted documented residual), SEC-03 (cache staleness window — accepted ADR-037 tradeoff), SEC-04 (no upper bound on Redis timeout env vars — deferred with `DATABASE_POOL_MAX`).

## Validation

- Typecheck: clean. Lint: 0 errors. Format (oxfmt): applied.
- Unit tier: 47 files / 405 tests green (was 46 files / 394 tests).
- Redis tier: 5 files / 65 tests green (was 4 files / 60 tests) — includes the black-hole fault-injection suite.
- Database tier: 4 files / 28 tests green. E2E tier: 16 files / 96 tests green.
- Final post-gate verification run (after the review fixes and the freeze hardening): unit 47/405, redis 5/65, database 4/28, e2e 16/96 — all green; typecheck clean; lint 0 errors.
- (Counts updated after the gates close if the reviews change anything.)

## Remaining Limitations (documented in ADR-037)

- Idle-connection dead peers are detected by TCP keepalive in minutes (OS defaults), not seconds; `socketTimeout` only bounds connections with commands in flight.
- `commandTimeout` rejections are ambiguous outcomes (the command may have executed server-side); exactly-once execution is not claimed — no mechanism ever re-executes them.
- The fault-injection test uses Toxiproxy `timeout` toxics (silent data stop), not a NIC-level fault; it reproduces the silent-drop semantics the attack relies on.
- The CR-05 blank-value siblings (`BODY_LIMIT`, `REDIS_CONNECT/COMMAND/SHUTDOWN_TIMEOUT_MS`, `REDIS_MAX_RETRIES_PER_REQUEST`) remain deferred (`DEFERRED.md`); the new `REDIS_SOCKET_TIMEOUT_MS` uses the correct pattern from day one (ai-decisions #25).

## References

- DECISIONS.md ADR-037 (accepted; proposal approved in plan mode), ADR-012/013 (Redis architecture unchanged), ADR-015/026 (health exemptions and contracts unchanged), ADR-016/020/025 (test containers), ADR-036 (the PostgreSQL counterpart)
- Verified installed sources: ioredis 6.0.0 (`built/Redis.js`, `built/Command.js`, `built/redis/event_handler.js`, `built/redis/RedisOptions.js`)
- `DEFERRED.md` (SEC-INFO-01 → Done); `docs/judge-findings.md` Wave 24; `docs/ai-decisions.md` #24/#25
