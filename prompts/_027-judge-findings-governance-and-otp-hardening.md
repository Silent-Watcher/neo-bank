# 027 — Judge AI Findings Governance and OTP Verification Remediation (ADR-019)

## Original User Request

Prompt (condensed): Review and remediate the four Judge AI findings from the OTP challenge implementation. Two objectives: (1) establish permanent project rules — mandatory Judge findings tracking (documented first, investigated second, remediated only after approval, no silent discards), approval before choosing remediation strategies, ADR requirements for judge-origin changes, and a no-magic-strings rule; (2) investigate and resolve the four findings without new vulnerabilities or architectural inconsistencies. Explicit constraints: do not blindly implement judge recommendations; no direct ioredis outside the Redis abstraction; stop for approval before implementing.

User decisions: approved the tracker location (`docs/judge-findings.md`), F1 option (a) (gate attempts on OTP existence, no per-phone verify limiter), F2 Option A (challenge ID + atomic compare-and-consume), F3/F4 recommendations, and ADR-019 scope (F1+F2 together); then approved implementation ("yes i approve now solve the findings"). Mid-implementation correction: `scriptReply` must follow the guard-clause rule (throw in the guard, happy path returns at the end).

## Implementation

- **Permanent rules (root `AGENTS.md`):** new "Judge Findings Tracking" + "Approval Before Remediation" subsections under the context-blind judgement section; new "No Magic Strings" section under Engineering Principles.
- **Tracker:** new `docs/judge-findings.md` with status lifecycle (`Reported` → `Investigating` → `Awaiting Approval` → `Approved` → `In Progress` → `Resolved` / `Won't Fix`) and Wave 1 (the four findings, full investigation records). All four now `Resolved`.
- **ADR-019** (Accepted, `DECISIONS.md`): conditional attempt counting (resolve script counts attempts only when the OTP key exists → a lockout can never arise without a live challenge; brute-force protection unchanged) and challenge identity (per-issuance UUIDv4 stored as `<challengeId>:<digest>`; the resolve consumes only when the stored ID still equals the verified one → the stale-match window from ADR-018 is closed). ADR-018's residual-window paragraph annotated as superseded.
- **F1+F2 code:** `RESOLVE_OTP_VERIFICATION_SCRIPT` — lockout check → challenge-ID compare-and-consume → existence gate → attempt branch; `resolveOtpVerification(otpKey, attemptsKey, lockoutKey, observedChallengeId, matched, maxAttempts, lockoutTtlSeconds)`. `enrollments.otp-digest.ts` gains `OtpChallengeValue`, `composeOtpChallengeValue`, strict-format `parseOtpChallengeValue` (fail-closed). Service issues `randomUUID()`-tagged values and passes the observed ID. The ID is random non-secret material — comparing it in Lua does not violate the "no secret digest comparisons in Lua" constraint; `crypto.timingSafeEqual` remains the only secret-derived comparison (Node).
- **F3:** `OTP_SEND_WINDOW_MINUTES = 60` replaces the literal. Contract verified first: `checkOtpRateLimit(key, maxSends, windowMinutes)` multiplies by 60×1000 — the original call was correct; naming-only change.
- **F4:** `scriptReply(result: unknown): number` guard narrows `eval` replies; named codes `SCRIPT_SUCCESS`/`SCRIPT_OTP_LOCKED`; dual-compare idiom removed from all four consumers. Contract basis: `stringNumbers` is never enabled (`redis-options.ts`), single fixed client (`redis.provider.ts`).
- **Docs:** `docs/security-otp-enrollment.md` (parameters, flow, state machine, §2.5 lockout DoS now requires a live challenge, §2.6 concurrency, §4 risks), `docs/current-state.md`, `docs/judge-findings.md` statuses.

## Validation

- `pnpm typecheck` — pass.
- `pnpm test` (unit) — 28 files / 231 tests pass (after a clean `pnpm build` removed the stale compiled spec twins under `dist/` that Vitest had been double-collecting; `tsconfig.build.json` excludes specs).
- `pnpm test:redis` — 60 tests pass, including new ADR-019 cases: garbage verification without any challenge creates no attempts/lockout and issuance still works; expired OTP leaves no state; a replaced challenge is never consumed through a stale match and the replacement still verifies; concurrent attempt limit still exactly maxAttempts.
- `pnpm test:e2e` — 65 tests pass (initial run failed across unrelated suites because the shared Redis on host port 6380 was down — the e2e env.test target; started the compose dev Redis with `REDIS_PORT=6380 docker compose --env-file .env.docker -f compose.dev.yml up -d redis`, after which all suites passed; the foreign Redis container on 6379 was left untouched).
- `pnpm format` applied; `pnpm lint` — 0 errors, no new warnings vs baseline.
- Independent judge: this remediation's own changes were reviewed during the previous wave's process; the F4 guard-structure correction came from the user directly.

## Notes

- Infrastructure: compose `neo-bank-dev-redis-1` left running on host port 6380 (started for e2e; healthy). The unrelated `redis` container on 6379 (started externally during the session) was not touched. No other task processes remain.
- No commit created (awaiting explicit user approval).
