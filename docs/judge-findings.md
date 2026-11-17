# Judge AI Findings Tracker

Permanent tracking for findings produced by the context-blind AI code judge
(see the "Judge Findings Tracking" rule in the root `AGENTS.md`). Every finding
is recorded here first, investigated second, and remediated only after the
user approves the chosen strategy. Findings judged invalid stay in this file
with their technical justification and the status `Won't Fix`.

**Status lifecycle:** `Reported` → `Investigating` → `Awaiting Approval` →
`Approved` → `In Progress` → `Resolved` / `Won't Fix (justification)`.

**Review waves:**

- **Wave 1** — 2026-11-10 — judge review of ADR-018 implementation
  (HMAC-SHA-256 digest storage, enrollments OTP flow). 1 Critical/High: none;
  findings below.
- **Wave 2** — 2026-11-11 — judge review of ADR-021 implementation (en/fa
  i18n: module registration, Zod pipe translation, error title keys, filter,
  envelope, Redis health indicator, catalog-consistency spec). 0 Critical,
  0 High, 4 Medium, 6 Low; findings below.
- **Wave 2b** — 2026-11-11 — judge re-review of the three Wave 2 revisions
  (batched pipe translation, title-key comment, array-excluding catalog
  guard). 0 Critical/High; 1 contingent Medium invalidated, 1 Low and
  1 Medium accepted and fixed; findings below.
- **Wave 3** — 2026-11-11 — judge review of the centralized logging
  infrastructure (compose.monitoring.yml, Alloy/Loki/Grafana configs,
  provisioned dashboard). 0 Critical, 2 High, 2 Medium, 6 Low; findings
  below.
- **Wave 4** — 2026-11-11 — judge review of the ADR-023 multi-agent tooling
  (hook scripts, sync.mjs). 0 Critical, 3 Medium, 18 Low; findings below.
- **Wave 5** — 2026-11-12 — judge review of the ADR-024 MockServer
  integration (dev-only Compose service, optional MockServer URL env schema,
  startup-log section). 0 Critical, 0 High, 0 Medium, 2 Low; findings below.

---

## Wave 1 — ADR-018 implementation review (2026-11-10)

### F1 — Lockout can be triggered without an existing OTP challenge

- **Status:** Resolved (2026-11-10, ADR-019 — user approved option (a): gate the attempt branch on OTP existence; per-phone verify limiter rejected as YAGNI)
- **Severity:** Medium
- **Category:** Security
- **Locations:** `RESOLVE_OTP_VERIFICATION_SCRIPT` (`apps/api/src/shared/redis/redis.service.ts`); `EnrollmentsService.requestChallenge` `'locked'` path (`apps/api/src/modules/enrollments/enrollments.service.ts`)
- **Technical explanation:** when no OTP key exists, the resolve script's fall-through branch still `INCR`s `attemptsKey` and, at `maxAttempts`, sets `lockoutKey`. Because `ISSUE_OTP_SCRIPT` refuses issuance while a lockout exists, verification garbage can lock a phone out of issuance without any challenge ever being created for it.
- **Failure scenario:** an attacker sends ≥5 verify requests with garbage OTPs for a victim phone (from ≥2 IPs, or >120 s apart, to pass the per-IP 5/120s throttle) without the victim requesting anything; issuance is then blocked for the lockout window (900 s), repeatable for persistent enrollment denial of service.
- **Judge recommendation:** only increment attempts when an OTP challenge actually exists (`EXISTS otpKey == 1` before the attempt branch); additionally consider an independent rate limit for `verifyChallenge`.
- **Investigation results:**
  - Corrected premise: `POST /enrollments/verify` **does** have a per-IP throttle (5 req/120 s, `@Throttle` on the controller), but no per-phone limit — the distributed per-phone DoS is real. The behavior itself predates ADR-018 (the old fully-atomic `VERIFY_OTP_ATTEMPTS_SCRIPT` counted attempts on missing OTPs identically) and is the documented trade-off in `docs/security-otp-enrollment.md` §2.5; it was not introduced by the ADR-018 changes.
  - State-path audit: `attemptsKey` is written only in the resolve script's fall-through branch; `lockoutKey` is set only at `attempts >= maxAttempts` in that same branch and read by both `ISSUE_OTP_SCRIPT` (EXISTS → refuse issuance) and the resolve script (EXISTS → reject). Gating the `INCR` branch on `EXISTS otpKey == 1` therefore removes every path that can create a lockout without a live challenge.
  - Brute-force impact: guessing is only meaningful against a stored OTP. With an active challenge, wrong guesses still count and still reach the lockout — the enforced attempt limit is unchanged. An attacker cannot keep an OTP alive to farm attempts (TTL fixed at 120 s, `SET NX` prevents extension), cannot reset the attempts counter inside the lockout window (attempts key TTL = 900 s, persisted across challenge replacement — ADR-017), and gains nothing from spamming without a challenge (no state change, per-IP throttled volume).
  - Edge cases checked: OTP expiring between the Node-side `GET` and the resolve (falls to the gated branch — no count, matches "expired OTP" semantics); repeated verification without any OTP (no count, no lockout); concurrent verifications (unchanged script atomicity); concurrent issuance and verification (unchanged); lockout expiry and re-issuance (unchanged); stale `attemptsKey` (TTL 900 s, harmless); successful-verification cleanup (unchanged — all three keys cleared).
  - No new enumeration or inconsistent-error surface: the resolve result remains a single boolean and every failure already returns one generic error.
  - Residual after gating: unbounded _volume_ of garbage verifies from many IPs (each is one `GET` + one `EVAL`, no state change). Covered today by the global throttler; an optional per-phone verify limiter (sorted-set Lua mirroring `checkOtpRateLimit`, new key `neo-bank:enrollments:challenge:verify-rate-limit:<phone>`) is defense-in-depth but adds a script + key for a vector that no longer has a security effect — recommended as **Won't Fix / future** unless the user wants it now.
  - **Viable options:** (a) gate the attempt branch on OTP existence (script-only change) — recommended; (b) option (a) + per-phone verify rate limiter — more code, no additional security effect after (a); (c) separate "lock verification" from "lock issuance" — larger behavioral redesign of ADR-017 semantics, not justified.
  - ADR: required (behavioral change to lockout semantics) — proposed as part of ADR-019.
- **Agreed resolution:** pending user approval.

### F2 — Stale match can consume a replaced challenge

- **Status:** Resolved (2026-11-10, ADR-019 — user approved Option A: per-issuance challenge ID (`crypto.randomUUID()`) bound into the stored value `<challengeId>:<digest>`; the resolve script consumes only when the stored ID still equals the verified one. WATCH/MULTI/EXEC (Option B) rejected as unnecessary machinery; Option C rejected as race-reintroducing)
- **Severity:** Low
- **Category:** Correctness
- **Locations:** `EnrollmentsService.verifyChallenge` (`apps/api/src/modules/enrollments/enrollments.service.ts`), `GET` → `resolveOtpVerification` sequence; `RESOLVE_OTP_VERIFICATION_SCRIPT`
- **Technical explanation:** the digest comparison runs against a `GET` snapshot, but the resolve script's consume condition is only `matched && EXISTS otpKey`. Between the `GET` and the `EVAL`, the OTP key can expire and a new challenge can re-create it with a _different_ digest (`SET NX` guards only an existing key), so a matched decision consumes the new challenge without it being verified.
- **Failure scenario:** sub-millisecond window; the holder of a genuinely valid (now-expired) OTP submits it while a re-issuance lands in the gap; the new OTP is consumed and the response is success, although the new code was never verified. No authentication bypass (matching still requires a valid OTP for that same phone; phone binding blocks cross-phone substitution); impact is self-consumption/confusion. Documented as a residual in ADR-018 and `docs/security-otp-enrollment.md` §2.6.
- **Judge recommendation:** bind consumption to challenge identity — unique challenge ID/version per issuance, verified atomically at consumption time; alternatives: `WATCH`/`MULTI`/`EXEC`, or re-comparison returning the current value.
- **Investigation results:**
  - Comparing a _challenge identifier_ (a random UUID, not secret-derived and not attacker-controllable to a useful degree) inside Lua is not a secret digest comparison — the user's constraint ("no secret digest comparisons using ordinary Lua string equality") is preserved. `crypto.timingSafeEqual` remains the only comparison of secret-derived material and stays in Node.
  - **Option A — challenge ID + atomic compare-and-consume (recommended):** issuance stores `<challengeId>:<digest>` (challengeId = `crypto.randomUUID()`, no `:` in UUIDs, digest is hex — unambiguous parse); the service reads the value, parses, compares the digest with `timingSafeEqual`, and passes the observed challengeId to the resolve script; the script consumes only when the currently stored value's ID prefix equals the observed one — otherwise the challenge was replaced and the request falls to the attempt branch. One script, one round trip, no new pattern. Preserves ADR-018's enforced semantics and fixes the stale consume.
  - **Option B — `WATCH`/`MULTI`/`EXEC`:** watching `otpKey` gives optimistic concurrency (EXEC aborts if the key changed after WATCH), but the match decision is made outside the transaction and the multi-key resolve (attempts/lockout) needs all three keys watched; requires a bounded retry loop and introduces a transaction pattern that does not exist anywhere in the codebase. Guarantees are equivalent to Option A with more machinery and a new failure mode (retry exhaustion).
  - **Option C — script returns current value for Node re-comparison:** re-introduces the comparison-after-fetch race it is meant to fix (second `GET` + compare + third round trip), or forces the digest comparison back into Lua — rejected.
  - Note: `DEFERRED.md` item 2 tracks an API-level `challengeId` (returned to clients); this remediation is internal identity only and does not consume that deferral — the API contract stays unchanged.
  - ADR: required (stored value format + resolve contract change) — proposed as part of ADR-019.
- **Agreed resolution:** pending user approval.

### F3 — Ambiguous rate-limit window argument

- **Status:** Resolved (2026-11-10 — user approved: `OTP_SEND_WINDOW_MINUTES = 60` extracted; behavior unchanged, contract verified as minutes)
- **Severity:** Low
- **Category:** Correctness / Syntax-Code Quality
- **Locations:** `EnrollmentsService.requestChallenge` (`apps/api/src/modules/enrollments/enrollments.service.ts`), `checkOtpRateLimit(..., 60)`
- **Technical explanation:** the call passes the literal `60` next to `MAX_OTP_SENDS_PER_HOUR`; the unit is only discoverable by reading `RedisService.checkOtpRateLimit`.
- **Judge recommendation:** establish the real contract first; do not blindly change `60` to `3600`; introduce a named, unit-carrying constant if a correction is needed.
- **Investigation results:**
  - Contract verified through the abstraction boundary: `checkOtpRateLimit(rateLimitKey, maxSends, windowMinutes)` computes `windowMs = windowMinutes * 60 * 1000` and `keyTtlSeconds = windowMinutes * 60`. The third argument is **minutes**; `60` is correct — the enforced limit is 5 sends per rolling 60 minutes. The judge's "possibly five per minute" hypothesis is ruled out by the implementation, and the redis-spec asserts the hourly behavior (`enrollments-lockout.redis-spec.ts` "hourly rate limit is independent of lockout").
  - No other call sites exist; the method contract is single-consumer.
  - Architectural boundary check: `EnrollmentsService` imports no ioredis anywhere; the only ioredis imports in the codebase live in `src/shared/redis/` (`redis.provider.ts`, `redis-options.ts`, type-only usages) — no violation found.
  - **Viable options:** (a) extract `OTP_SEND_WINDOW_MINUTES = 60` next to `MAX_OTP_SENDS_PER_HOUR` and pass it — naming-only change, behavior preserved; (b) leave as-is — the judge's concern is style-level; (c) change the parameter to seconds — behavior-preserving but touches the abstraction contract for zero benefit — rejected.
  - ADR: not required (no behavioral change).
- **Agreed resolution:** pending user approval (recommendation: option (a)).

### F4 — Ambiguous Lua script return-type contract

- **Status:** Resolved (2026-11-10 — user approved: `eval` replies narrowed by a fail-fast `scriptReply` guard (happy-path returns the number, guard throws on anything else); named return codes `SCRIPT_SUCCESS`/`SCRIPT_OTP_LOCKED`; the defensive dual-compare idiom and its stale test replaced. The guard-clause structure was corrected on user feedback during implementation)
- **Severity:** Low
- **Category:** Syntax / Code Quality
- **Locations:** `RedisService.issueOtp`, `RedisService.resolveOtpVerification`, `RedisService.deleteIfEquals`, `RedisService.checkOtpRateLimit` (`apps/api/src/shared/redis/redis.service.ts`)
- **Technical explanation:** `eval` results are typed `unknown` and compared as `result === 1 || result === '1'` (and `'3'`), accepting both numbers and strings without a declared contract.
- **Judge recommendation:** establish the actual return type from the project's abstraction, then either type it precisely or normalize once at the boundary; name the script return codes; do not change comparisons based on assumptions about ioredis defaults.
- **Investigation results:**
  - Contract verified: `buildRedisOptions` (`redis-options.ts`) does **not** enable `stringNumbers`, and the provider builds a single fixed client (`redis.provider.ts`) — there is exactly one representation in play: ioredis returns Lua integer replies as JavaScript **numbers**. The dual comparison is defensive-only and documented in `deleteIfEquals` ("stringNumbers clients would see '1'"), but the codebase has no second client and no config path that could enable `stringNumbers`.
  - All four consumers duplicate the same narrowing idiom; the return codes (`1` issued/consumed, `0` failure, `3` locked) are commented in the script headers but not named constants in TypeScript.
  - **Viable options:** (a) type the `eval` result as `number` in the RedisService (the abstraction's contract; verified by real-Redis integration tests) and compare numerically; name the return codes as constants in `redis.service.ts` — precise, removes the duplicated dual-compare idiom; (b) normalize once with `Number(result)` and branch numerically — equivalent outcome, one extra conversion per call; (c) keep the current defensive dual-compare — zero risk, preserves the documented "accept both" stance. The abstraction supports exactly one client, so (c)'s defensiveness protects against a configuration that cannot occur.
  - ADR: not required (internal type-contract precision inside the designated infrastructure layer; behavior unchanged).
- **Agreed resolution:** pending user approval (recommendation: option (a)).

---

## Wave 2 — ADR-021 implementation review (2026-11-11)

Context: the judge received only the eight reviewed files (module
registration, pipe, error key maps, filter, envelope, Redis health
indicator, catalog spec) with no feature description. Findings processed by
the implementing agent; the three accepted minor fixes (F4, F8, F9) do not
change the agreed design and were applied directly per the
"minor implementation details" exception; everything else below is recorded
with its technical justification.

### F1 — 5xx logs lose the original exception object

- **Status:** Won't Fix (pre-existing behavior, outside i18n scope)
- **Severity:** Medium
- **Category:** Correctness (observability)
- **Locations:** `ProblemDetailsFilter.normalize`/`catch` (`apps/api/src/shared/filters/problem-details.filter.ts`)
- **Technical explanation:** `NormalizedException.error` is populated only in
  the unknown-exception branch; deliberately-thrown `InternalServerErrorException`
  or 5xx `AppHttpException` log `{ err: undefined }`.
- **Judge recommendation:** attach the original exception for all 5xx paths.
- **Investigation results:** verified against the pre-change tree — the
  `error` population logic is byte-identical to the code before the i18n
  task; every logged 5xx already behaved this way. The task's constraints
  prohibit unrelated behavior changes to the error/logging pipeline, and a
  logging-behavior change is a separate decision (log volume, redaction
  surface for exception messages on deliberate 5xx throws).
- **Agreed resolution:** out of scope for the i18n task; recorded for a
  future logging-focused task.

### F2 — Raw ioredis error message exposed in the health response

- **Status:** Won't Fix (pre-existing, documented design decision)
- **Severity:** Medium
- **Category:** Security
- **Locations:** `RedisHealthIndicator.check` (`apps/api/src/shared/redis/redis.health.ts`)
- **Technical explanation:** ioredis error messages can contain internal
  host/port/topology and are passed through to the health payload.
- **Judge recommendation:** return only the localized fallback; log the raw
  error internally.
- **Investigation results:** the passthrough predates the i18n task and is an
  explicit, commented decision ("host/port … never credentials or the full
  URL") tied to the Health endpoint's monitoring contract, which this task
  must not alter (task constraint: preserve Health semantics). The i18n task
  only localizes the non-Error fallback branch. Changing the payload of a
  monitoring endpoint is a separate behavioral decision.
- **Agreed resolution:** unchanged; candidate for a future security pass on
  the health contract (would need its own ADR).

### F3 — Path-less Zod issues other than `invalid_type` stay English

- **Status:** Won't Fix (YAGNI; documented extension point)
- **Severity:** Medium
- **Category:** Edge Case
- **Locations:** `ZodValidationPipe.translateWholeInputIssue` (`apps/api/src/shared/pipes/zod-validation.pipe.ts`)
- **Technical explanation:** the pipe explicitly translates only path-less
  `invalid_type` issues; other root-level issue codes would keep Zod's
  English message in a Persian response.
- **Judge recommendation:** translate every path-less issue via
  `validation.<code>` keys with a safe fallback for unknown codes.
- **Investigation results:** the request-facing schemas in the API are
  `z.object` bodies; the only path-less issues they can produce today are
  `invalid_type` (body not an object). No root-level `z.enum`, root
  `z.string().min()`, or root `.refine()` exists in any request schema.
  A generic "translate when the key exists" branch is impossible without an
  existence check in the pipe (the pipe is constructed manually, no DI, and
  `t()` under the dev/test `throw` policy would turn an unknown code into an
  HTTP 500) — the per-code branch with an in-place comment is the
  fail-safe design. The pipe comment instructs extending the branch when a
  future schema introduces new whole-input codes.
- **Agreed resolution:** keep per-code handling; extension point documented
  in the pipe.

### F4 — Catalog spec accepts array-valued entries

- **Status:** Resolved (2026-11-11 — applied)
- **Severity:** Medium
- **Category:** Edge Case
- **Locations:** `i18n.catalog.spec.ts` `leaves()` (`apps/api/src/i18n/i18n.catalog.spec.ts`)
- **Technical explanation:** `leaves()` used `isRecord` (arrays pass), so an
  array-valued catalog entry would be flattened into numeric-keyed leaves and
  all consistency tests would still pass.
- **Judge recommendation:** use the array-excluding guard in `leaves()`.
- **Investigation results:** valid; `isCatalog` already excludes arrays, and
  array entries then fail the string-type assertion in the values test.
- **Agreed resolution:** applied — `leaves()` now recurses only through
  `isCatalog` and treats arrays as (invalid) leaves.

### F5 — Non-string validation message array yields an empty `detail`

- **Status:** Won't Fix (pre-existing behavior, outside i18n scope)
- **Severity:** Low
- **Category:** Edge Case
- **Locations:** `ProblemDetailsFilter.detailFromHttpException` (`apps/api/src/shared/filters/problem-details.filter.ts`)
- **Technical explanation:** an exception response whose `message` array
  contains no strings joins to `''`.
- **Judge recommendation:** fall back to `exception.message` when the join is
  empty.
- **Investigation results:** the filter logic is unchanged from the
  pre-i18n tree; producing non-string message arrays is not something the
  application's pipes do (the Zod pipe always emits strings). Changing
  `detailFromHttpException` is an error-contract behavior change outside the
  task's mandate.
- **Agreed resolution:** unchanged; candidate for a future error-contract
  hardening task.

### F6 — Filter sends a reply without checking `reply.sent`

- **Status:** Won't Fix (pre-existing behavior, outside i18n scope)
- **Severity:** Low
- **Category:** Edge Case
- **Locations:** `ProblemDetailsFilter.catch` (`apps/api/src/shared/filters/problem-details.filter.ts`)
- **Technical explanation:** an exception surfacing after the response was
  sent would make the filter's `send()` throw `FST_ERR_REP_ALREADY_SENT`.
- **Judge recommendation:** guard the send with `reply.sent`.
- **Investigation results:** identical behavior on the pre-i18n tree; the
  exception-filter invocation contract of the running NestJS/Fastify version
  has not produced this path in the test suites (unit + e2e + Redis
  integration all green). A defensive `reply.sent` guard changes global
  error-path behavior and belongs to an error-contract task.
- **Agreed resolution:** unchanged.

### F7 — Titles could leak catalog keys outside a request context

- **Status:** Won't Fix (invalid — verified not applicable)
- **Severity:** Low
- **Category:** Edge Case
- **Locations:** `ProblemDetailsFilter.localizedTitle`, `normalize`
- **Technical explanation (judge assumption):** if `I18nService.t` behaved
  like the standalone `t()` (returns the key outside a request), exceptions
  handled before the locale context would leak key names.
- **Judge recommendation:** verify the service's out-of-context behavior.
- **Investigation results:** verified in the installed package source —
  `I18nService.currentLocale` is `i18nStorage.getStore()?.locale ??
  this.defaultLocaleValue` (`dist/i18n.service.js`, `currentLocale`
  getter): outside a request the service translates with `defaultLocale`
  ('en'), never the raw key. The standalone `t()` (used in the pipe) returns
  the key outside a request, but the pipe only runs inside the request
  pipeline the i18n middleware wraps.
- **Agreed resolution:** no code change needed.

### F8 — Error-code title key map is incomplete and the comment overclaims

- **Status:** Resolved (2026-11-11 — applied)
- **Severity:** Low
- **Category:** Syntax / Code Quality
- **Locations:** `ERROR_CODE_TITLE_KEYS` (`apps/api/src/shared/errors/error.code.ts`)
- **Technical explanation:** `BadRequest` and `NotFound` intentionally have
  no entry (they fall back to the status keys) but the comment claimed a
  one-to-one mirror of the English titles map.
- **Judge recommendation:** make the map exhaustive or correct the comment.
- **Investigation results:** the fallback to `titleKeyForStatus` is
  intentional (identical English text; one source per message); exhaustiveness
  would duplicate the status keys for no benefit.
- **Agreed resolution:** applied — comment now states which codes fall back
  and why.

### F9 — Pipe allocates an array per issue during translation

- **Status:** Resolved (2026-11-11 — applied)
- **Severity:** Low
- **Category:** Performance
- **Locations:** `ZodValidationPipe.transform` (`apps/api/src/shared/pipes/zod-validation.pipe.ts`)
- **Technical explanation:** `translateStandardSchemaIssues` was invoked once
  per issue with a single-element array.
- **Judge recommendation:** pass the whole array once.
- **Investigation results:** valid; the helper maps issues 1:1 and handles
  each independently, so a single call is equivalent.
- **Agreed resolution:** applied — one call over the mapped issue array.

### F10 — Silent catalog-layout regression in production

- **Status:** Won't Fix (covered by existing verification layers)
- **Severity:** Low
- **Category:** Edge Case (operational)
- **Locations:** `CATALOG_PATH` (`apps/api/src/shared/i18n/i18n.module.ts`)
- **Technical explanation (judge assumption):** if the dist layout ever
  changed, production would silently degrade to English.
- **Judge recommendation:** add a startup assertion for the catalog path.
- **Investigation results:** the layout is pinned by `nest-cli.json` assets
  (`i18n/**/*.json` → `dist/i18n`), verified by the build step of this task;
  the relative depth of the module file is identical in `src/` and `dist/`;
  every e2e test loads the real catalogs (a missing catalog fails the suite
  loudly in dev/test), and the Docker image copy step is verified in
  `docs/docker.md`'s build. A startup assertion would need a new
  infrastructure hook in the loader path — not justified while three
  independent layers already catch the regression.
- **Agreed resolution:** none; revisit if the build layout ever changes.

### F-R1 — Batched pipe translation trusts an unverified 1:1 library contract

- **Status:** Won't Fix (invalid — contract verified in source and pinned by an existing test)
- **Severity:** Medium (contingent)
- **Category:** Correctness
- **Locations:** `ZodValidationPipe.transform` (`apps/api/src/shared/pipes/zod-validation.pipe.ts`)
- **Technical explanation (judge assumption):** if
  `translateStandardSchemaIssues` omitted skipped issues instead of mapping
  1:1, path-less issues would vanish from the error list.
- **Judge recommendation:** length-safe zip fallback or a contract-pinning
  test.
- **Investigation results:** the installed package's
  `translateStandardSchemaIssues` is a plain `issues.map(...)` over the input
  array (`dist/validation/standard-schema-messages.js`) — it cannot change
  the array's length; every skipped issue is returned as-is. Additionally,
  the existing pipe spec test "formats root-level issues without a path
  prefix" runs a path-less issue through `transform()` and asserts the
  message array has length 1 — if the helper ever dropped issues, that test
  fails. A defensive zip would guard a contract that is both source-verified
  and test-pinned.
- **Agreed resolution:** none; the judge's contingent scenario cannot occur.

### F-R2 — "Identical English text" invariant is documented but unenforced

- **Status:** Resolved (2026-11-11 — applied)
- **Severity:** Low
- **Category:** Edge Case / Code Quality
- **Locations:** `ERROR_CODE_TITLE_KEYS` comment (`apps/api/src/shared/errors/error.code.ts`)
- **Technical explanation:** the comment claimed the status-based fallback
  keys' English text is identical to the English title map — an invariant
  nothing enforces.
- **Judge recommendation:** test the invariant or drop the claim.
- **Investigation results:** an assertion tying catalog JSON values to the
  TypeScript title map would couple the catalog spec to a shared module for
  a claim with no behavioral consumer (the filter always translates the
  title; `buildProblemDetails`'s English text only serves the pre-i18n
  request-ID path, which uses a different code).
- **Agreed resolution:** applied — the comment now states only the enforced
  fact: the status keys serve as the title source for those codes.

### F-R4 — Plural-category test was vacuous

- **Status:** Resolved (2026-11-11 — applied)
- **Severity:** Medium
- **Category:** Correctness (test suite)
- **Locations:** plural test, `i18n.catalog.spec.ts` (`apps/api/src/i18n/i18n.catalog.spec.ts`)
- **Technical explanation:** `leaves()` yields only scalar leaves, so the
  plural test's `isRecord(value)` gate never passed — the test body (and all
  its assertions) could never execute; a mistyped plural category in both
  catalogs would pass every test.
- **Judge recommendation:** walk the tree directly for plural-shaped nodes.
- **Investigation results:** valid — dead test.
- **Agreed resolution:** applied — new `pluralNodes()` walk yields
  plural-shaped nodes (not descended into), the test asserts symmetric
  en/fa plural-key parity plus every `Intl.PluralRules('fa')` category per
  Persian plural message. No plural messages exist today, so the parity
  assertion is what keeps a one-locale plural addition visible.

---

## Wave 3 — Centralized logging infrastructure review (2026-11-11)

Judge review of the monitoring stack configs (`compose.monitoring.yml`,
`monitoring/alloy/config.alloy`, `monitoring/loki/loki.yml`,
`monitoring/grafana/provisioning/**`, `monitoring/grafana/dashboards/api-logs.json`,
`.env.monitoring.example`). 0 Critical, 2 High, 2 Medium, 6 Low — 10 findings.
Remediation note: all resolutions below are implementation-level refinements
inside the already-authorized architecture (no behavioral or architectural
decision); per the root AGENTS.md approval rule these were handled directly,
and the user can veto any of them before commit.

### F1 — Missing per-container label enables out-of-order rejection at replica scale

- **Status:** Resolved (2026-11-11 — applied: `container` label rule added)
- **Severity:** High
- **Category:** Correctness / Edge Case
- **Locations:** `monitoring/alloy/config.alloy` (discovery.relabel "containers", loki.process "pino"); `monitoring/loki/loki.yml` (limits_config)
- **Technical explanation:** the stream label set is `{env, service, level}`; two replicas of one service (e.g. `--scale api=2`) share one stream while entry timestamps come from each process's own pino clock via `stage.timestamp` (UnixMs). Loki 3.x rejects entries older than a stream's newest timestamp (`out_of_order_time_window` defaults to 0), and the push client drops the whole batch on 4xx.
- **Failure scenario:** replica B's older-timestamped line pushed after replica A's newer line returns 400 "entry out of order"; the batch, including unrelated valid lines, is discarded — chronic silent loss exactly when scaling is used. A clock-skewed replica poisons the shared stream.
- **Judge recommendation:** add a bounded per-container label (e.g. `container` = service-index), or set `out_of_order_time_window`.
- **Investigation results:** valid. A `container` label keeps cardinality tiny (one per running container) and gives per-replica granularity, which also improves request-ID investigation (which replica served the request). The time-window alternative trades correctness for silent reordering — rejected.
- **Agreed resolution:** applied — third relabel rule `container = "$2-$3"` (service-index from the container name).

### F2 — Docker socket grants the Alloy container full daemon control

- **Status:** Resolved (2026-11-11 — applied: `no-new-privileges`; proxy documented as production work)
- **Severity:** High
- **Category:** Security
- **Locations:** `compose.monitoring.yml` (alloy service, docker.sock mount)
- **Technical explanation:** `:ro` restricts the mount, not the Docker API; code execution inside the alloy container equals host-root control. Pinning, loopback-only ports, and the non-root user reduce exposure but do not reduce the privilege of a compromise.
- **Failure scenario:** a compromised image or a malicious `config.alloy` edit creates a privileged container binding `/` — host takeover through the "read-only" socket.
- **Judge recommendation:** accept as a documented local-only risk but reduce blast radius: a restricted read-only-API socket proxy, and `security_opt: ["no-new-privileges:true"]`; replace socket tailing entirely beyond a personal machine.
- **Investigation results:** valid as a risk statement. A socket proxy (e.g. tecnativa/docker-socket-proxy) adds a required infrastructure component with its own maintenance and failure modes for a single-user learning stack — rejected now under YAGNI/KISS, recorded as a production requirement in the observability docs and learning guide (Chapter 8). `no-new-privileges` is free hardening.
- **Agreed resolution:** applied — `security_opt: ['no-new-privileges:true']` on alloy; socket-proxy + alternatives documented as mandatory production work, not implemented.

### F3 — Healthchecks assume tooling the images may not ship

- **Status:** Resolved (2026-11-11 — superseded by empirical fixes; evidence recorded)
- **Severity:** Medium
- **Category:** Correctness
- **Locations:** `compose.monitoring.yml` (healthchecks of loki, grafana, alloy)
- **Technical explanation:** the judge assumed `grafana/loki` is Alpine-based with busybox `wget`, `grafana/grafana` ships `curl` not `wget`, and `grafana/alloy` may lack `wget` — permanent `unhealthy` status if absent.
- **Failure scenario:** probes failing with "executable file not found" forever while services are fine; misleading status that defeats the probes' purpose.
- **Judge recommendation:** verify per image; use curl for Grafana; keep wget only for loki.
- **Investigation results:** premise partially incorrect — verified empirically in this environment: `grafana/loki:3.7.9` is distroless (no shell at all, so the judge's "keep wget for loki" is impossible); `grafana/grafana:13.2.5` DOES ship busybox `wget` and reported `healthy`; `grafana/alloy:v1.21.0` has no wget/curl (the judge's concern was correct here and had already been observed live — health stayed `starting`).
- **Agreed resolution:** applied — alloy probe rewritten as a perl `IO::Socket::INET` HTTP request against `/-/ready` (perl is bundled); loki healthcheck removed with an explanatory comment (distroless; readiness checked from the host: `curl http://127.0.0.1:3100/ready`); grafana wget verified working and kept.

### F4 — Service variable uses an undocumented `label_values` form

- **Status:** Resolved (2026-11-11 — applied: brace form)
- **Severity:** Medium
- **Category:** Correctness
- **Locations:** `monitoring/grafana/dashboards/api-logs.json` (templating `service` variable)
- **Technical explanation:** `label_values(env=~"$env", service)` is not one of the documented Loki variable query forms (`label_values(label)` or `label_values({stream selector}, label)`); behavior on the brace-less matcher form is undocumented and may 400.
- **Failure scenario:** the Service dropdown never populates; every panel query interpolating `$service` degrades or shows no data.
- **Judge recommendation:** use the documented form `label_values({env=~"$env"}, service)` and verify the dropdown populates.
- **Investigation results:** valid — the brace form is the documented variant and reads unambiguously.
- **Agreed resolution:** applied — `definition`/`query` switched to `label_values({env=~"$env"}, service)`; dropdown population is part of the verification checklist in `docs/observability/manual-testing.md`.

### F5 — Containers with an explicit `container_name` would be ingested unlabeled and invisible

- **Status:** Resolved (2026-11-11 — applied: `keep` guard rule)
- **Severity:** Low
- **Category:** Edge Case
- **Locations:** `monitoring/alloy/config.alloy` (discovery.relabel "containers")
- **Technical explanation:** `env`/`service` derive solely from the `<project>-<service>-<index>` name regex; a container with an explicit `container_name:` (still matching the project filter) matches no rule and is ingested without labels — invisible to every positive-matcher panel and to `label_values(env)`.
- **Failure scenario:** someone adds `container_name: api` to an app service; its logs silently vanish from all dashboards.
- **Judge recommendation:** fallback relabel rule, or document that `container_name` must not be used in the app compose files.
- **Investigation results:** a true fallback is not expressible in relabel (a later `replace` would overwrite the primary rule's result); the consistent alternative is a `keep` guard: entries whose container name does not match the expected pattern are dropped at ingestion instead of being stored unlabeled. The repo's compose files set no `container_name`, so nothing is dropped today.
- **Agreed resolution:** applied — leading `keep` rule on `__meta_docker_container_name` (regex `/neo-bank-(dev|prod)-.*`), making the failure mode consistent and observable in Alloy's dropped-entries metrics; naming constraint documented in the guide's Alloy chapter.

### F6 — "Errors and fatals" panel structurally excludes plain-text error lines

- **Status:** Resolved (2026-11-11 — applied: panel retitled and description scoped)
- **Severity:** Low
- **Category:** Edge Case
- **Locations:** `monitoring/grafana/dashboards/api-logs.json` (panel 3; panel 1 legend)
- **Technical explanation:** only pino-parsed API lines carry the `level` label; PostgreSQL/Redis/frontends log plain text. Panel 3 (`level=~"error|fatal"`) can never show their fatal lines, and `sum by (level)` renders an empty legend series for level-less streams.
- **Failure scenario:** PostgreSQL fails loudly with plain-text fatal lines; the errors panel shows nothing from it while panel 1 grows an anonymous series — misleading triage.
- **Judge recommendation:** qualify the panel title/description, or add per-service level parsing (`stage.match`).
- **Investigation results:** per-service parsing rules add pipeline complexity for logs outside the API's structured contract — rejected (KISS/YAGNI). Honest labeling is the right fix for the initial dashboard; per-service parsing is listed as a learning exercise in the guide (Chapter 10, advanced).
- **Agreed resolution:** applied — panel 3 retitled "API errors and fatals (structured `level` label)" with an explicit description; panel 1 description notes level-less services appear under an empty legend entry.

### F7 — Discovered Compose project names are hard-coded in two places

- **Status:** Won't Fix (justification) — documented instead
- **Severity:** Low
- **Category:** Edge Case
- **Locations:** `monitoring/alloy/config.alloy` (discovery.docker filter + relabel regex)
- **Technical explanation:** `neo-bank-dev`/`neo-bank-prod` appear as literals in the discovery filter and the relabel regex; starting a stack under a different project name yields zero discovered containers and a silent no-data state.
- **Failure scenario:** `docker compose -p local up` → Loki stays empty, dashboards show "No data", Alloy logs nothing alarming.
- **Judge recommendation:** document the constraint next to the start scripts and/or derive the names from environment variables (`std.getenv`).
- **Investigation results:** the project names are fixed repo-wide constants (`name:` in compose.dev/prod.yml and the documented scripts); deriving them through Alloy env plumbing adds indirection for a configuration that is not actually variable (YAGNI). The residual risk is a renamed/extra stack, covered by documentation of the failure mode in the ops README troubleshooting section and the learning guide's Alloy debugging section (which also covers the Alloy debug UI on the internal :12345).
- **Agreed resolution:** Won't Fix — constraint and diagnosis path documented; literals stay.

### F8 — Anonymous usage telemetry is enabled by default in Loki and Grafana

- **Status:** Resolved (2026-11-11 — applied: reporting disabled)
- **Severity:** Low
- **Category:** Security (privacy)
- **Locations:** `monitoring/loki/loki.yml` (no analytics block); `compose.monitoring.yml` (grafana environment)
- **Technical explanation:** Loki 3.x reports anonymous usage stats by default (`analytics.report_enabled: true`); Grafana phones home (usage reporting, update checks) by default — the stack's only built-in egress despite its otherwise isolated design.
- **Failure scenario:** a deliberately network-isolated local stack periodically sends machine/version/usage telemetry to third-party endpoints.
- **Judge recommendation:** `analytics: { report_enabled: false }` in loki.yml; `GF_ANALYTICS_REPORTING_ENABLED: 'false'` (plus the update-check equivalent) in the grafana environment.
- **Investigation results:** valid; zero-cost change consistent with the isolation intent.
- **Agreed resolution:** applied — `analytics.report_enabled: false` in loki.yml; `GF_ANALYTICS_REPORTING_ENABLED: 'false'` and `GF_ANALYTICS_CHECK_FOR_UPDATES: 'false'` on grafana (verified warning-free at startup in verification).

### F9 — Grafana port binds all interfaces; admin password readable via docker inspect

- **Status:** Resolved (2026-11-11 — applied: loopback bind; `__FILE` documented)
- **Severity:** Low
- **Category:** Security
- **Locations:** `compose.monitoring.yml` (grafana.ports); `.env.monitoring.example` (GRAFANA_ADMIN_PASSWORD)
- **Technical explanation:** `'${GRAFANA_PORT:-3002}:3000'` binds 0.0.0.0, making the admin UI LAN-reachable; the admin password travels as a plain env var readable via `docker inspect`.
- **Failure scenario:** on a shared network, anyone reaching :3002 faces only the (unthrottled) Grafana login; anyone with Docker access reads the password from inspect — largely moot locally (socket access already equals root) but free to reduce.
- **Judge recommendation:** bind loopback; switch to `GF_SECURITY_ADMIN_PASSWORD__FILE` beyond a personal laptop.
- **Investigation results:** loopback binding is consistent with the Loki port decision and costs nothing locally. The `__FILE` variant is a deployment-topology concern — documented as production work.
- **Agreed resolution:** applied — `'127.0.0.1:${GRAFANA_PORT:-3002}:3000'`; file-based secret noted in docs as a production requirement.

### F10 — Redundant trailing `$` in anchored relabel regexes

- **Status:** Resolved (2026-11-11 — applied)
- **Severity:** Low
- **Category:** Syntax / Code Quality
- **Locations:** `monitoring/alloy/config.alloy` (both relabel rules)
- **Technical explanation:** Prometheus-style relabel regexes are compiled fully anchored; the trailing `$` implies anchoring behaves differently than it does.
- **Failure scenario:** none — readability only.
- **Judge recommendation:** drop the `$` (or anchor consistently and explicitly everywhere).
- **Investigation results:** valid; dropped in the two existing rules and not introduced in the new rules from F1/F5.
- **Agreed resolution:** applied.

---

## Wave 4 — ADR-023 multi-agent tooling review (2026-11-11)

- **Wave 4** — 2026-11-11 — context-blind judge review of the ADR-023
  implementation tooling: `scripts/agents/sync.mjs`,
  `.agents/plugins/monorepo-workflow/hooks/session-start.mjs`,
  `.agents/plugins/monorepo-workflow/hooks/guard-documentation-write.mjs`.
  0 Critical, 0 High, 2 Medium, 15 Low. No user approval was required for the
  remediations below: all are minor implementation hardening inside the
  accepted ADR-023 design; none changes behavior for the primary agent or
  adds/removes a review gate.

### W4-F1 — Guard covers only Write/Edit; other write-capable tools pass through

- **Status:** Resolved (2026-11-11 — applied)
- **Severity:** Medium
- **Category:** Security
- **Locations:** `.agents/plugins/monorepo-workflow/hooks/guard-documentation-write.mjs` (`GUARDED_TOOLS`, `decidePreToolUse`)
- **Technical explanation:** enforcement keyed to exactly two tool names lets any other write-capable tool the platform may expose (e.g. `MultiEdit`, `NotebookEdit`) reach the pass-through branch for the guarded agent.
- **Failure scenario:** `documentation-writer` calls `NotebookEdit` against `apps/api/src/…`; the hook passes through, source is modified while the session believes the policy is enforced.
- **Judge recommendation:** enumerate the platforms' write-capable tools, or deny unrecognized tools for the guarded agent.
- **Investigation results:** the subagent's native tool allowlist (`Write, Edit` only) is the first enforcement layer, so the gap requires the platform to inject extra tools beyond the frontmatter — undocumented behavior. Denying unknown tools risks blocking legitimate tools with no benefit. Adding the known write-capable tools (`MultiEdit`, `NotebookEdit`) to the guard closes the gap with zero behavioral risk; `notebook_path` added as a target path source (fail-closed when absent). Covered set documented in the script header.
- **Agreed resolution:** applied — `GUARDED_TOOLS = {Write, Edit, MultiEdit, NotebookEdit}`; self-test extended.

### W4-F2 — Lexical-only allow check; symlinks inside docs/ escape the boundary

- **Status:** Resolved (2026-11-11 — applied)
- **Severity:** Medium
- **Category:** Security
- **Locations:** `.agents/plugins/monorepo-workflow/hooks/guard-documentation-write.mjs` (`isDocumentationPath`, `decidePreToolUse`)
- **Technical explanation:** the allow check inspects the path string only; a symlink planted inside `docs/`/`prompts/` pointing outside the repo passes the prefix check and the write lands at the target. Planting requires an unguarded channel (the guarded agent has no Bash and cannot create symlinks via Write), so this compounds W4-F1 rather than standing alone.
- **Failure scenario:** symlink `docs/escape-link.md → /etc/…` exists; `Write docs/escape-link.md` writes outside the repository while the hook decision says "allowed, inside docs".
- **Judge recommendation:** realpath the target (resolving the nearest existing ancestor) and re-verify containment.
- **Investigation results:** valid as defense-in-depth and cheap (~15 lines, only paid for guarded-agent writes).
- **Agreed resolution:** applied — `resolveRealPath` (nearest-existing-ancestor realpath) before containment check; verified live with a symlink planted in `docs/` → decision `deny`.

### W4-F3 — Substring agent matching looser than identity matching

- **Status:** Resolved (2026-11-11 — applied)
- **Severity:** Low
- **Category:** Correctness
- **Locations:** `.agents/plugins/monorepo-workflow/hooks/guard-documentation-write.mjs` (`isGuardedAgent`)
- **Technical explanation:** `agentType.includes('documentation-writer')` also captures hypothetical agents whose id merely contains the phrase.
- **Failure scenario:** a future `documentation-writer-reviewer` agent is denied every non-documentation write and the denial looks like an unrelated platform error.
- **Judge recommendation:** normalize to the id's last segment and compare for equality.
- **Investigation results:** verified from platform evidence that plugin subagent ids are `plugin:agent` (ZCode wraps as `zcode-<agentType>`, Claude Code uses the bare name); last-segment equality covers both verified forms.
- **Agreed resolution:** applied — last-segment equality (split on `:` / `/`); self-test extended with the lookalike agent.

### W4-F4 — Silent fail-open on unparseable payload leaves the guard undetectably disabled

- **Status:** Resolved (2026-11-11 — applied)
- **Severity:** Low
- **Category:** Edge Case
- **Locations:** `.agents/plugins/monorepo-workflow/hooks/guard-documentation-write.mjs` (`main`)
- **Technical explanation:** malformed JSON collapses into the same silent pass-through as a legitimate non-match; nothing distinguishes "not a match" from "could not parse".
- **Failure scenario:** a platform update changes payload serialization; every decision becomes pass-through and the policy silently stops being enforced.
- **Judge recommendation:** write a diagnostic to stderr (never stdout, which is schema-parsed).
- **Investigation results:** valid; fail-open itself is correct (the agent cannot forge its payload, so this is not a bypass vector) but needs observability.
- **Agreed resolution:** applied — stderr diagnostic on the parse-failure path only.

### W4-F5 — Module has import-time side effects alongside exported functions

- **Status:** Resolved (2026-11-11 — applied)
- **Severity:** Low
- **Category:** Syntax / Code Quality
- **Locations:** `.agents/plugins/monorepo-workflow/hooks/guard-documentation-write.mjs`, `session-start.mjs` (top-level execution blocks)
- **Technical explanation:** importing the module to reuse `decidePreToolUse`/`denyOutput` would execute the hook branch (blocking stdin read or stdout emission).
- **Failure scenario:** a future test file importing the exported functions hangs or pollutes stdout.
- **Judge recommendation:** gate execution on main-module detection.
- **Investigation results:** valid; `pathToFileURL(path.resolve(argv[1]))` comparison applied to both hook scripts (the robust form, argv[1] may be relative). Enabled the live symlink verification to import the module cleanly.
- **Agreed resolution:** applied.

### W4-F6 — Self-test assertion total hardcoded; cases not normalized through helpers

- **Status:** Resolved (2026-11-11 — applied)
- **Severity:** Low
- **Category:** Syntax / Code Quality
- **Locations:** `.agents/plugins/monorepo-workflow/hooks/guard-documentation-write.mjs` (`runSelfTests`)
- **Technical explanation:** printed total assumed a fixed number of assertions outside the case table; mixed inline case construction.
- **Failure scenario:** adding one shape assertion makes the reported count lie while the test still passes.
- **Judge recommendation:** count assertions dynamically; normalize cases through helpers.
- **Investigation results:** valid, cosmetic but cheap.
- **Agreed resolution:** applied — counter-based `check()` helper; `write()`/`edit()` helpers; total reported from the counter (29 assertions pass).

### W4-F7 — Tool items rendered into YAML without character validation

- **Status:** Resolved (2026-11-11 — applied)
- **Severity:** Low
- **Category:** Correctness
- **Locations:** `scripts/agents/sync.mjs` (`renderZcodeAgent`, `renderClaudeAgent`, `validateDefinition`)
- **Technical explanation:** tools items are joined raw into a YAML flow sequence and a comma-separated scalar; special characters could produce frontmatter the target parsers reject or truncate.
- **Failure scenario:** a definition with `- tool[x,y]` generates an agent file that fails to load, surfacing far from the edit.
- **Judge recommendation:** require each item to match `/^[A-Za-z0-9_-]+$/`.
- **Investigation results:** valid and consistent with real tool identifiers.
- **Agreed resolution:** applied in `validateDefinition`.

### W4-F8 — Duplicate frontmatter keys silently last-win

- **Status:** Resolved (2026-11-11 — applied)
- **Severity:** Low
- **Category:** Correctness
- **Locations:** `scripts/agents/sync.mjs` (`parseFrontmatter`)
- **Technical explanation:** a repeated key overwrites silently, so the generator's view and the platform YAML parser's view can diverge.
- **Failure scenario:** `description:` authored twice; the second value wins and `--check` still passes.
- **Judge recommendation:** throw on redefined keys.
- **Investigation results:** valid; fail-loud is the generator's contract.
- **Agreed resolution:** applied.

### W4-F9 — BOM or leading whitespace yields a misleading "missing frontmatter" error

- **Status:** Resolved (2026-11-11 — applied)
- **Severity:** Low
- **Category:** Edge Case
- **Locations:** `scripts/agents/sync.mjs` (`parseFrontmatter`)
- **Technical explanation:** a UTF-8 BOM before `---` defeats the anchored regex and the error claims the block is missing.
- **Failure scenario:** editor-saved BOM file fails sync with a wrong-direction error.
- **Judge recommendation:** strip the leading BOM before matching.
- **Investigation results:** valid, one line.
- **Agreed resolution:** applied.

### W4-F10 — A directory named `*.md` in the definitions dir produces a raw EISDIR error

- **Status:** Resolved (2026-11-11 — applied)
- **Severity:** Low
- **Category:** Edge Case
- **Locations:** `scripts/agents/sync.mjs` (`listDefinitions`, `loadDefinitions`)
- **Technical explanation:** `readdir` returns directories too; a `.md`-suffixed directory reaches `readFile` and dumps a stack trace.
- **Failure scenario:** `mkdir .agents/definitions/tmp.md` breaks every sync run with an unactionable error.
- **Judge recommendation:** `withFileTypes` filtering or a `SyncError` naming the entry.
- **Investigation results:** valid; files-only filter plus a `skipped` stderr line for visibility.
- **Agreed resolution:** applied.

### W4-F11 — Write mode does not converge: orphaned generated files are never removed

- **Status:** Resolved (2026-11-11 — applied)
- **Severity:** Low
- **Category:** Edge Case
- **Locations:** `scripts/agents/sync.mjs` (write branch, `runCheck` unexpected-file scan)
- **Technical explanation:** after a rename/delete of a definition, the stale generated agent remains and platforms keep loading it; write mode exits 1 with no cleanup.
- **Failure scenario:** renaming `code-reviewer.md` leaves a dead `code-reviewer` agent discoverable alongside the new one.
- **Judge recommendation:** delete known orphans or print explicit remediation.
- **Investigation results:** the generated `*.md` files in the two agent directories are unambiguously the script's own output ("never edit generated files"); deleting orphans there is within the generator's remit and keeps platforms from loading dead agents. Scope is limited to exactly those two directories, `*.md`, non-expected names.
- **Agreed resolution:** applied — write mode removes orphaned generated `*.md` agents and reports each removal; verified live with a planted orphan.

### W4-F12 — Unknown CLI arguments silently ignored (typo can select mutating mode)

- **Status:** Resolved (2026-11-11 — applied)
- **Severity:** Low
- **Category:** Edge Case
- **Locations:** `scripts/agents/sync.mjs` (`main`)
- **Technical explanation:** any argument other than `--check` is ignored, so `--chekc` silently performs a full write in a CI drift check.
- **Failure scenario:** a typoed CI step masks drift with exit code 0.
- **Judge recommendation:** reject unrecognized flags with a usage error.
- **Investigation results:** valid.
- **Agreed resolution:** applied — usage error, exit 1.

### W4-F13 — `unquote` preserves escape sequences, which are then double-escaped into output

- **Status:** Resolved (2026-11-11 — applied)
- **Severity:** Low
- **Category:** Syntax / Code Quality
- **Locations:** `scripts/agents/sync.mjs` (`unquote` → `yamlScalar`, `validateDefinition`)
- **Technical explanation:** quoted values keep literal backslash sequences; `JSON.stringify` then double-escapes them into the generated YAML, silently losing author intent.
- **Failure scenario:** a description authored with an intended newline renders as a literal `\n` with no error anywhere.
- **Judge recommendation:** document the plain-scalar contract and reject backslashes.
- **Investigation results:** valid; loud rejection is consistent with the fail-loud generator contract.
- **Agreed resolution:** applied — `validateDefinition` rejects backslash-containing frontmatter values with an explanatory message.

### W4-F14 — Unbounded, timeout-less stdin read in session-start hook

- **Status:** Resolved (2026-11-11 — applied)
- **Severity:** Low
- **Category:** Edge Case
- **Locations:** `.agents/plugins/monorepo-workflow/hooks/session-start.mjs` (`readStdin`)
- **Technical explanation:** the hook buffers all of stdin with no cap and no timeout; a host that keeps the pipe open blocks session start until the platform timeout.
- **Failure scenario:** platform regression leaves stdin open; every session start stalls with no diagnostic.
- **Judge recommendation:** byte cap plus a raced timer that fails open.
- **Investigation results:** valid; the payload is discarded, so capping/timeout is free of functional risk.
- **Agreed resolution:** applied — `drainStdin` with 64 KiB cap and 2.5 s timer, always resolving then emitting the instruction.

### W4-F15 — Empty-string platform env vars select the wrong output shape

- **Status:** Resolved (2026-11-11 — applied)
- **Severity:** Low
- **Category:** Edge Case
- **Locations**: both hook scripts (`isZcode`)
- **Technical explanation:** `!== undefined` treats `ZCODE_PROJECT_DIR=''` as a platform marker, emitting the ZCode shape into a Claude Code parser.
- **Failure scenario:** a wrapper exports the variable empty; the injected instruction is dropped by strict-schema validation with no visible error.
- **Judge recommendation:** treat only non-empty values as markers.
- **Investigation results:** valid, one line per script.
- **Agreed resolution:** applied — `.some((value) => value !== undefined && value !== '')` in both scripts.

**Wave 4 review rounds:** the same isolated judge re-reviewed the revised
scripts after each remediation batch. Round 2 found the six primary
remediations correct but introduced-by-fix defects R1–R3 and a residual R4
Medium; round 3 verified R1–R4 closed, confirmed `session-start.mjs` and
`guard-documentation-write.mjs` clean with no actionable findings, and raised
R5 (a verification request, resolved from existing validation evidence — see
below). Final state: all findings closed.

### W4-R1 — BOM strip fix was itself buggy (body slicing off by one)

- **Status:** Resolved (2026-11-11 — applied, verified round 3)
- **Severity:** Low
- **Category:** Correctness
- **Locations:** `scripts/agents/sync.mjs` (`parseFrontmatter`, `loadDefinitions`)
- **Technical explanation:** round 2 stripped the BOM inside `parseFrontmatter` and computed `bodyStart` on the stripped string, but the body was sliced from the original source — a one-character offset error that `--check` could never detect because generator and checker share the same code.
- **Failure scenario:** a BOM-saved definition generates agents whose body silently starts one character early.
- **Judge recommendation:** strip the BOM in `loadDefinitions` so the offset indexes the string actually sliced.
- **Investigation results:** valid.
- **Agreed resolution:** applied — BOM stripped once in `loadDefinitions`; round-3 judge verified end-to-end consistency.

### W4-R2 — duplicate-key check trips on inherited Object.prototype properties

- **Status:** Resolved (2026-11-11 — applied, verified round 3)
- **Severity:** Low
- **Category:** Edge Case
- **Locations:** `scripts/agents/sync.mjs` (`parseFrontmatter`)
- **Technical explanation:** `key in fields` tests the prototype chain; a first occurrence of `toString:`/`constructor:` was falsely reported as a duplicate.
- **Failure scenario:** `toString: x` in frontmatter aborts sync with a confusing false error.
- **Judge recommendation:** use `Object.hasOwn`.
- **Investigation results:** valid; `__proto__` remains unreachable through the key regex (leading letter required), so no prototype-pollution vector.
- **Agreed resolution:** applied.

### W4-R3 — main-module gating silently disables hooks under symlinked invocation

- **Status:** Resolved (2026-11-11 — applied, verified round 3)
- **Severity:** Low
- **Category:** Edge Case
- **Locations:** both hook scripts (`isMainModule` / top-level execution)
- **Technical explanation:** Node realpaths the ESM entry module, so symlinked hook invocation (plugin cache installs) made `import.meta.url` differ from the link path in `argv[1]`; the gated hook exited 0 with no output.
- **Failure scenario:** every session starts without the workflow instruction, with no error.
- **Judge recommendation:** remove the gating (session-start has no exports — pure downside) or realpath-normalize `argv[1]` (guard keeps gating for its exports).
- **Investigation results:** valid; both options applied per file.
- **Agreed resolution:** applied — gating removed entirely in `session-start.mjs`; `isMainModule()` in the guard normalizes `argv[1]` through `realpathSync` (resolved-path fallback, fail-open direction).

### W4-R4 — dangling symlinks inside documentation directories bypass the containment check

- **Status:** Resolved (2026-11-11 — applied, verified round 3)
- **Severity:** Medium
- **Category:** Security
- **Locations:** `.agents/plugins/monorepo-workflow/hooks/guard-documentation-write.mjs` (`resolveRealPath` → replaced by `containsSymlinkComponent`)
- **Technical explanation:** the round-2 nearest-existing-ancestor realpath re-appended the unresolved link name for dangling symlinks, resurrecting the lexical docs path and allowing a write the platform would follow outside the repository.
- **Failure scenario:** a dangling `docs/report.md → /etc/cron.d/job` symlink (planted via an unguarded channel — the guarded agent has no Bash) turns into an out-of-repo file creation through a "allowed, inside docs" decision.
- **Judge recommendation:** `lstat` the target and each tail segment; deny any symlinked component outright.
- **Investigation results:** valid; the component-scan approach also closes the resolvable/broken-link cases and is simpler than link re-resolution. Policy tightening (benign intra-repo symlinks now deny) is documented in the script header.
- **Agreed resolution:** applied — `containsSymlinkComponent` lstat-scans every component below the repo root; any symlinked component (resolvable, dangling, broken) denies. Live temp-dir self-tests cover all three link kinds plus a regular-file allow (33 assertions). Round-3 judge probed the semantics (nonexistent components, traversal, root boundary, TOCTOU) and found no actionable issues.

### W4-R5 — plugin manifest contract change needs out-of-isolation verification

- **Status:** Resolved (2026-11-11 — verified from existing evidence, no code change)
- **Severity:** Low
- **Category:** Correctness (platform-schema dependent)
- **Locations:** `scripts/agents/sync.mjs` (`pluginManifest`, marketplaces), `.agents/plugins/monorepo-workflow/.claude-plugin/plugin.json`
- **Technical explanation:** the round-2 → round-3 manifest change (`agents`/`hooks` as `./`-prefixed paths, marketplace `description`) was flagged by the isolated judge as unverifiable within its evidence scope (it could not read the validator output or the hooks file).
- **Failure scenario:** if the schema expected plain directory strings, plugin loading could break and `--check` would preserve the wrong output.
- **Judge recommendation:** confirm `hooks/hooks.json` exists and the `./`-prefix schema claim before shipping.
- **Investigation results:** both verifications already existed: (1) `claude plugin validate` read and validated `hooks/hooks.json` directly and the whole plugin **passes**; (2) the schema claim is empirical, not assumed — the round-2 shape (`agents: 'agents'`, `hooks: 'hooks'`) produced four hard validator errors ("must start with ./", "must end with .json"/".md") and the changed shape passes. Residual uncertainty is only ZCode's runtime acceptance, which is the documented pending install-verification item (ZCode's configuration guide allows arrays for component fields and ZCode reads this manifest as its Claude-compat format).
- **Agreed resolution:** no code change; evidence recorded here and in the prompt record.

**Wave 4 summary:** 21 findings across three review rounds — 3 Medium
(W4-F1, W4-F2, W4-R4), 18 Low — all investigated and closed: applied as
in-scope hardening (no design change, no separate approval needed) or
resolved from existing validation evidence (W4-R5). Round-3 verdict:
`session-start.mjs` and `guard-documentation-write.mjs` clean with no
actionable findings; `sync.mjs` clean apart from the evidence-resolved R5.

---

## Wave 5 — ADR-024 MockServer integration review (2026-11-12)

### W5-F1 — Empty MockServer section can be rendered for a both-null address pair

- **Status:** Resolved (2026-11-12 — applied in-scope hardening, re-review passed)
- **Severity:** Low
- **Category:** Edge Case
- **Locations:** `buildStartupLogMessage` (`apps/api/src/shared/http/startup-url.ts`); `MockServerStartupUrls` type contract
- **Technical explanation:** the section guard only checked `mockserverUrls !== null`, but the type permits `{ host: null, docker: null }`, which would render a bare `MockServer:` header with no addresses. The only current caller (`main.ts`) cannot produce that shape (a non-null section requires at least one defined URL), so there was no runtime failure; the gap was latent for future callers.
- **Failure scenario:** a future caller generalizing the config passes `{ host: null, docker: null }` and the startup log advertises a MockServer section the operator cannot use.
- **Judge recommendation:** normalize inside `buildStartupLogMessage` (treat both-null as "no section") or narrow the type.
- **Investigation results:** valid. Normalizing inside the renderer is the safer option: it protects every future caller at one point instead of encoding the invariant in a type that no static analysis enforces at construction sites.
- **Agreed resolution:** applied — the section now renders only when at least one address is non-null; regression test extended to cover `{ host: null, docker: null }`.

### W5-F2 — Username-only URL rejection is untested in the shared URL helper

- **Status:** Resolved (2026-11-12 — regression test added, re-review passed)
- **Severity:** Low
- **Category:** Edge Case (test completeness)
- **Locations:** credential-rejection refine in `optionalHttpUrlEnv` (`apps/api/src/shared/config/env/schema/validation-helpers.ts`); `apps/api/src/shared/config/env/schema/server.env.spec.ts`
- **Technical explanation:** the refine also rejects username-only URLs (`http://admin@host`, no password), a load-bearing branch now shared by three variables through the helper but pinned by no test; a future refactor checking only `password` would silently allow username-bearing values into the startup log.
- **Failure scenario:** a regression in the credential check goes unnoticed by the suite.
- **Judge recommendation:** add a username-only rejection case to the env-schema spec.
- **Investigation results:** valid; the shared helper backs `REDIS_INSIGHT_URL` and both `MOCKSERVER_*` variables, so one explicit case pins the branch for all three.
- **Agreed resolution:** applied — username-only rejection case added to the `MOCKSERVER_HOST_URL` describe block.

**Wave 5 summary:** 2 findings, both Low — both valid, both applied as
in-scope hardening (renderer normalization + regression test; no design
change, no separate approval needed per the Wave 4 precedent). Re-review
verdict: APPROVED, no remaining findings.

---

## Wave 6 — ADR-024 MockServer integration security review (2026-11-13)

### SEC-01 — Unauthenticated MockServer control port published on all host interfaces

- **Status:** Resolved (2026-11-13 — loopback binding applied, security re-review passed)
- **Severity:** Low (CWE-668; secondary CWE-918)
- **Category:** Security
- **Locations:** `mockserver` service port mapping (`docker/compose.app.dev.yml`)
- **Technical explanation:** the bare `'${MOCKSERVER_PORT:-1080}:1080'` mapping publishes on `0.0.0.0`. MockServer has no authentication, and its control API supports arbitrary `httpForward` targets, so a network-adjacent attacker could reach the developer's port 1080, inject forward expectations, and pivot requests at internal HTTP endpoints (SSRF-style) or silently poison resilience-test expectations.
- **Failure scenario:** dev stack running on a laptop/VM on a shared network; an adjacent attacker scripts `PUT /mockserver/expectation` with an `httpForward` action against an internal endpoint and reads responses through the mock port.
- **Judge recommendation:** bind the published port to loopback (`127.0.0.1:${MOCKSERVER_PORT:-1080}:1080`). Nothing is lost: host developers use `http://localhost:<port>`, containers use the internal Compose network and never the published port.
- **Investigation results:** valid and actionable — the only service in the dev stack that cannot be authenticated at all, and the monitoring stack already established the explicit-loopback precedent for dev tooling (Grafana/Loki). Consistent with ADR-020's requirement that developer tooling interfaces stay restricted to the local environment.
- **Agreed resolution:** applied — port mapping bound to `127.0.0.1`; compose comment, ports table, and ADR-024 wording updated to match.

### SEC-02 — Residual C0/ANSI control characters can reach the pretty startup log (informational)

- **Status:** Won't Fix (operator-only vector, no realistic attacker path; technically justified)
- **Severity:** Informational (CWE-117)
- **Category:** Security
- **Locations:** `optionalHttpUrlEnv` (`apps/api/src/shared/config/env/schema/validation-helpers.ts`), consumed by the startup log
- **Technical explanation:** zod's URL output strips tab/LF/CR (closing newline log forging) but can pass other C0 control characters through, so an env value containing terminal escape sequences could reach `pino-pretty` console output. Reaching it requires write access to the API's environment — operator-equivalent privileges — and in containerized (JSON) mode Pino escapes the sequences anyway.
- **Failure scenario:** an operator writes an ANSI-escaped value into an env file and observes cosmetic terminal disruption on their own console; no confidentiality or integrity impact.
- **Judge recommendation (optional):** normalize the logged value to `new URL(url).href` or reject remaining C0 controls in the helper. Not required for approval.
- **Investigation results:** not applied. The `href` normalization variant would change documented `REDIS_INSIGHT_URL` output (e.g. trailing-slash canonicalization) and its exact-value tests; the C0-rejection variant adds validation logic guarding only operator-self-inflicted cosmetic output — excessive defensiveness for a dev-only diagnostics line (AGENTS.md: avoid defensive programming when the contract already guarantees behavior). Newline forging is already closed by zod stripping.
- **Agreed resolution:** Won't Fix with the justification above; revisit only if these values ever gain a consumer beyond the startup log.

### SEC-03 — Redis Insight URL lacks the development gate applied to the MockServer section (informational)

- **Status:** Won't Fix (out-of-scope behavior change to pre-existing ADR-020 behavior; documented as intentional)
- **Severity:** Informational (CWE-532, defense-in-depth asymmetry only)
- **Category:** Security
- **Locations:** `main.ts` startup-log wiring (`redisInsightUrl` passed presence-gated only, while `mockserverUrls` is additionally `APP_ENV=Development`-gated)
- **Technical explanation:** the MockServer section carries a double gate (presence + development environment); the pre-existing Redis Insight line is presence-gated only, so a stray value in a non-development environment would be logged. The helper guarantees a credential-free URL, and the documented convention is set-only-where-exposed, so there is no realistic leak path.
- **Failure scenario:** an operator sets `REDIS_INSIGHT_URL` in a non-development environment; a non-functional URL appears in that startup log. No secret disclosure.
- **Judge recommendation (optional):** apply the same development gate to the Redis Insight URL for symmetry.
- **Investigation results:** not applied: it would change the logging behavior of an existing, separately reviewed ADR-020 feature outside this task's scope ("do not modify unrelated startup behavior"). The asymmetry is documented as intentional hardening in the `main.ts` comment and ADR-024; the underlying invariant (never advertise an address that does not exist) is preserved by the presence gate for both.
- **Agreed resolution:** Won't Fix with the justification above.

**Wave 6 summary:** 3 findings — 1 actionable Low (SEC-01, fixed and
re-reviewed), 2 informational (SEC-02/SEC-03, Won't Fix with technical
justification). No Critical/High/Medium findings.

---

## Wave 7 — Task 4 (environment governance) code review (2026-11-13)

Review scope: `apps/api/src/shared/config/env/schema/enrollments.env.ts`
(behavior-preserving helper swap), population of
`apps/api/env/.env.development` / `.env.production`, root `AGENTS.md`
stability subsection, `docs/ai-decisions.md`, `PROJECT_CONTEXT.md` index row.
Verdict: `CHANGES_REQUIRED` → remediated → re-review below.

### TF4-1 — Empty `KEY=` env entries crash startup for five Redis variables

- **Status:** Resolved
- **Severity:** Critical
- **Category:** Correctness / Edge Case
- **Locations:** `apps/api/env/.env.development` and `.env.production` —
  `REDIS_TLS=`, `REDIS_CONNECT_TIMEOUT_MS=`, `REDIS_COMMAND_TIMEOUT_MS=`,
  `REDIS_MAX_RETRIES_PER_REQUEST=`, `REDIS_SHUTDOWN_TIMEOUT_MS=` (and
  `REDIS_DB=` for semantic consistency)
- **Technical explanation:** `node --env-file` and Compose `env_file` deliver
  `KEY=` as the empty **string**, not as an absent variable. The schema
  defaults apply only to `undefined`: `REDIS_TLS` (`z.enum(['true','false'])`)
  rejects `''`, and the four `positiveSafeInteger(...).default(...)` fields
  coerce `Number('') === 0` and fail `.positive()`. The aggregate schema runs
  at module import, so both populated files crashed at startup on every path
  (`pnpm dev`, dev Compose, prod Compose).
- **Failure scenario:** every startup using either populated file throws
  `EnvValidationError` before binding a port.
- **Judge recommendation:** populate explicit schema-default values, or omit
  the keys (`.env.test` convention).
- **Investigation results:** confirmed against `redis.env.ts`,
  `redis.env.spec.ts`, and the `optionalHttpUrlEnv` helper's rationale.
  Populated explicit values instead of omitting keys, to keep the 27-name
  parity with `.env.example` (governance rule) and to document the effective
  configuration: `REDIS_DB=0`, `REDIS_TLS=false`,
  `REDIS_CONNECT_TIMEOUT_MS=10000`, `REDIS_COMMAND_TIMEOUT_MS=5000`,
  `REDIS_MAX_RETRIES_PER_REQUEST=3`, `REDIS_SHUTDOWN_TIMEOUT_MS=2000` in both
  files. (`.env.example` retains its blank template keys — pre-existing
  behavior outside this task's scope, noted for a future template-hardening
  pass.)
- **Agreed resolution:** fixed as above.

### TF4-2 — Production template sets `TRUST_PROXY=true` without any proxy in the shipped topology

- **Status:** Resolved
- **Severity:** Medium
- **Category:** Correctness (security-adjacent configuration)
- **Locations:** `apps/api/env/.env.production` (`TRUST_PROXY`)
- **Technical explanation:** no reverse proxy exists in any shipped
  production Compose topology (`compose.app.prod.yml` publishes the API port
  directly; `compose.prod.all.yml` only adds monitoring). With
  `trustProxy=true`, Fastify derives `req.ip` from client-supplied
  `X-Forwarded-For`, which feeds the Redis throttler's per-IP tracker —
  enabling rate-limit evasion and polluted client-IP logs.
- **Failure scenario:** a deployment using the template as shipped lets any
  client rotate `X-Forwarded-For` to defeat global rate limits.
- **Judge recommendation:** set `TRUST_PROXY=false`, or document the
  assumption explicitly.
- **Investigation results:** confirmed: no proxy service exists in the
  shipped stacks. Set `TRUST_PROXY=false` with a comment instructing that it
  may be set `true` only where a real proxy terminates client connections.
  (The original `true` had been an explicitly flagged assumption in the
  approved proposal; the review resolved the assumption against the shipped
  topology.)
- **Agreed resolution:** fixed as above.

### TF4-3 — "Mandatory post-task record" appears unanchored in the PROJECT_CONTEXT index row

- **Status:** Resolved (partial)
- **Severity:** Low
- **Category:** Documentation consistency
- **Locations:** `PROJECT_CONTEXT.md` documentation index row for
  `docs/ai-decisions.md`
- **Technical explanation:** the judge stated no rule establishes the
  record's mandatoriness. **Partially incorrect:** the mandate exists in root
  `AGENTS.md`, `## Agent Workflow` → `### AI Decision Log` ("After completing
  an implementation task … record the relevant independent decisions in
  `docs/ai-decisions.md`"). The judge examined the wrong region of the file.
  The residual point is fair: the index row did not point at that rule.
- **Failure scenario:** an agent consulting only the index could miss the
  governing rule.
- **Judge recommendation:** reference the rule or drop "mandatory".
- **Investigation results:** rule confirmed present; index row reworded to
  anchor it ("mandatory per root AGENTS.md Agent Workflow").
- **Agreed resolution:** index wording anchored to the rule; no rule change
  needed.

**Wave 7 summary:** 3 findings — 1 Critical (TF4-1, fixed: explicit
schema-default values populated), 1 Medium (TF4-2, fixed: `TRUST_PROXY=false`
with an explicit proxy assumption comment), 1 Low (TF4-3, partially
incorrect; index wording anchored). Re-review verdict recorded below.

**Wave 7 re-review (same reviewer):** `APPROVED` — TF4-1/TF4-2/TF4-3 all
verified fixed; no new defects introduced; key-set parity and schema validity
re-confirmed; no secrets in tracked files.

---

## Wave 8 — Task 4 (environment governance) security review (2026-11-13)

Review scope: identical to Wave 7. Verdict: `SECURITY_CHANGES_REQUIRED`
(1 actionable LOW) → remediated → re-review below.

### SEC-01 — Stale `TRUST_PROXY=true` statement in the _037 record contradicts the remediated value

- **Status:** Resolved
- **Severity:** Low
- **Category:** Security (documentation integrity on a security-relevant control; adjacent to CWE-1059)
- **Locations:** `prompts/_037-environment-governance.md` (Decisions section)
- **Technical explanation:** the Decisions bullet still presented production
  `TRUST_PROXY=true` as an explicit, commented assumption awaiting
  confirmation, while the Implementation section and the actual
  `.env.production` record the remediated `false` (Wave 7 TF4-2). A future
  agent reading the Decisions bullet could "confirm" the stale assumption and
  reintroduce client-IP spoofing against the per-IP rate limiter.
- **Failure scenario:** regression to `X-Forwarded-For`-spoofable rate limiting
  in a future production deployment, licensed by the project's own record.
- **Judge recommendation:** correct the stale bullet to record the final
  accepted decision.
- **Investigation results:** valid; the record predates the TF4-2 remediation
  and was not updated with it. Bullet rewritten to state the final value and
  the proxy-conditioned exception.
- **Agreed resolution:** fixed.

### SEC-02 — Production `BODY_LIMIT=2097152` doubles the schema default

- **Status:** Won't Fix (documented, approved choice)
- **Severity:** Informational (CWE-770, marginal)
- **Category:** Security / hardening
- **Locations:** `apps/api/env/.env.development`, `.env.production` (`BODY_LIMIT`)
- **Technical explanation:** 2 MiB is the deliberate, developer-approved value
  (matches the populated `.env.test` precedent; the schema default remains
  1 MiB for environments that leave it unset). Throughput is bounded by the
  per-IP rate limiter (10 req/s short policy) and fail-closed Redis behavior;
  no realistic exploit path was identified by the reviewer.
- **Judge recommendation (optional):** revert production to 1 MiB or document
  why it was raised.
- **Investigation results:** kept at 2 MiB per the approved plan; the value is
  a named, commented configuration entry that a future hardening pass can
  lower when real payload needs are known.
- **Agreed resolution:** Won't Fix with the justification above.

### SEC-03 — Development `HOST=0.0.0.0` exposes the dev API (and Swagger) to the local network

- **Status:** Won't Fix (accepted, documented trade-off)
- **Severity:** Informational (CWE-668)
- **Category:** Security / exposure
- **Locations:** `apps/api/env/.env.development` (`HOST`)
- **Technical explanation:** one dev file serves both host-local `pnpm dev`
  and the Compose container; the container requires `0.0.0.0` (nothing
  overrides `HOST` there). Mitigations already in place: exact-origin CORS
  allow-list, `TRUST_PROXY=false`, fail-closed Redis, loopback-bound
  MockServer. Exposure is limited to development data on the LAN.
- **Judge recommendation (optional):** keep `127.0.0.1` host-side and let the
  dev Compose `environment:` override `HOST: 0.0.0.0` (mirrors prod).
- **Investigation results:** not applied in this task: adding a `HOST`
  override to the dev compose `environment:` block is a compose-file behavior
  change outside this task's scope (env-file governance); it is recorded as a
  candidate for a future pass.
- **Agreed resolution:** Won't Fix with the justification above; follow-up
  candidate noted.

### SEC-04 — Non-Compose production can boot with an empty `REDIS_PASSWORD` against a passwordless Redis

- **Status:** Won't Fix (pre-existing schema behavior; fail-closed at runtime)
- **Severity:** Informational (CWE-1188, theoretical)
- **Category:** Security / configuration hardening
- **Locations:** `apps/api/src/shared/config/env/schema/redis.env.ts`
  (`REDIS_PASSWORD` allows empty), `apps/api/env/.env.production`
- **Technical explanation:** unlike `CORS_ORIGIN` (production superRefine) and
  `ENROLLMENTS_OTP_HMAC_SECRET` (64-hex regex), an empty `REDIS_PASSWORD`
  passes validation. The shipped Compose prod stack cannot boot that way
  (`${REDIS_PASSWORD:?…}` interpolation), and a password-protected Redis with
  an empty client password fails auth at runtime — the throttler storage
  rejects and every guarded route fails closed (verified fail-closed paths).
  The risk requires an operator to deliberately run a passwordless Redis.
- **Judge recommendation (optional):** production-only refinement requiring
  non-empty `REDIS_PASSWORD` when `APP_ENV=production`.
- **Investigation results:** not applied: it is a pre-existing schema behavior
  outside this task's scope (the task populated values; it did not change
  validation semantics), and the schema comment explicitly documents empty as
  "no authentication". A production-only superRefine is a valid future
  hardening candidate.
- **Agreed resolution:** Won't Fix with the justification above.

**Wave 8 summary:** 4 findings — 1 actionable Low (SEC-01, fixed), 3
informational (SEC-02/SEC-03/SEC-04, Won't Fix with technical justification;
SEC-03 carries a noted follow-up candidate). Re-review verdict recorded below.

---

## Wave 9 — Task 1 (E2E Testcontainers) code review (2026-11-13)

Review scope: `apps/api/test/e2e.global-setup.ts` (new),
`create-test-app.ts`, `vitest-e2e.config.ts`, the 14 renamed e2e specs, the
enrollments-spec Redis decoupling, `apps/api/package.json` (+lockfile).
Verdict: `APPROVED_WITH_SUGGESTIONS` (1 Low) → remediated → re-review below.

### CR-01 — Four stale comments contradicting the new Redis wiring

- **Status:** Resolved
- **Severity:** Low
- **Category:** Documentation / Syntax–Code Quality
- **Locations:** `apps/api/env/.env.test` (mechanism comment),
  `apps/api/test/enrollments.e2e-spec.ts` (~line 97),
  `apps/api/test/redis-health.e2e-spec.ts` (~line 7),
  `apps/api/test/testcontainers.ts` (~line 36)
- **Technical explanation:** four comments still described the old wiring —
  the `.env.test` comment claimed `createE2eTestApp` overrides
  `REDIS_CONFIG` (it overrides `REDIS_CLIENT`; the judge confirmed the
  `REDIS_CONFIG`-only route silently reconnects the placeholder env client);
  the enrollments spec said the global rate limiter "uses the real Redis from
  env.test"; redis-health said `.env.test` "points Redis at the real compose
  dev server"; and `testcontainers.ts` justified `GenericContainer` against
  the now-removed `@testcontainers/redis` package.
- **Failure scenario:** a maintainer following the `.env.test` comment would
  implement the ineffective `REDIS_CONFIG` override and get fail-closed 500s
  with no obvious cause.
- **Judge recommendation:** reword all four in the same change.
- **Investigation results:** valid; all four comments rewritten to describe
  the actual wiring (REDIS_CLIENT override, shared container, placeholder
  semantics, core-package rationale).
- **Agreed resolution:** fixed.

**Wave 9 summary:** 1 finding — 1 Low (CR-01, fixed). No correctness,
security, or architectural defects identified; the judge explicitly verified
override propagation to the throttler storage, client lifecycle on both
stubbed and real `RedisService` paths, redis-suite isolation, type
augmentation, dependency-removal safety, and failure paths. Re-review verdict
recorded below.

**Wave 9 re-review (same reviewer):** `APPROVED` — all four CR-01 locations
verified fixed; no new findings; surrounding code byte-identical to the
previously reviewed implementation.

---

## Wave 10 — Task 1 (E2E Testcontainers) security review (2026-11-13)

Review scope: e2e.global-setup.ts, create-test-app.ts override path, renamed
specs, enrollments-spec decoupling, package.json/lockfile, docs. Verdict:
`SECURITY_APPROVED_WITH_INFORMATIONAL_FINDINGS`.

### SEC-T1-01 — Ephemeral test Redis is Docker-published on all host interfaces during runs

- **Status:** Won't Fix (pre-existing Testcontainers default, accepted)
- **Severity:** Informational (CWE-668)
- **Category:** Security / exposure
- **Locations:** `apps/api/test/testcontainers.ts:38-45` (reused by `e2e.global-setup.ts`)
- **Technical explanation:** Docker's default port mapping publishes the
  password-protected, synthetic-data Redis on an ephemeral host port on all
  interfaces for the duration of a test run. This is the exact pattern the
  `test:redis` tier has used since ADR-016; the e2e tier previously targeted
  the loopback-bound compose Redis, so its exposure surface is new — but the
  reviewer classified it as theoretical (LAN adjacency + active run + known
  ephemeral port + public placeholder password + synthetic data only).
- **Failure scenario:** an adjacent-network attacker reaching the ephemeral
  port during a run could read/write synthetic test data.
- **Judge recommendation (optional):** document the reachability, or restrict
  via host firewall / CI network isolation.
- **Investigation results:** restricting the binding would deviate from the
  Testcontainers default used by both tiers and the ryuk/teardown cleanup
  already bounds the window; no code change required for approval per the
  reviewer. The exposure is documented here.
- **Agreed resolution:** Won't Fix with the justification above; revisit if a
  CI network-isolation policy is introduced.

**Wave 10 summary:** 1 finding — 1 informational (Won't Fix, documented). No
confirmed vulnerabilities; production code paths untouched by the change
(test → src dependency direction grep-verified).

---

## Wave 11 — Task 3 (memory load shedding) code review (2026-11-13)

Review scope: the full memory-protection layer (service, guard, indicator,
module, decorator, env schema + config factory, error code, redis health
strict variant, health controller readiness endpoint, app-module guard
ordering, prefix exclusions, i18n, env files, specs). Verdict:
`APPROVED_WITH_SUGGESTIONS` (4 suggestions) → remediated → re-review below.

### CR-01 — Duplicate `@nestjs/common` import statement

- **Status:** Resolved
- **Severity:** Suggestion
- **Category:** Syntax/Code Quality
- **Locations:** `apps/api/src/modules/app/health.controller.ts:1,5`
- **Technical explanation:** two import statements from the same module
  (line 5 added `ServiceUnavailableException` separately).
- **Failure scenario:** none functional; cosmetic.
- **Judge recommendation:** merge into the line-1 import.
- **Investigation results:** valid. Merged.
- **Agreed resolution:** fixed.

### CR-02 — `MEMORY_PROTECTION_SAMPLE_INTERVAL_MS` accepts values Node silently clamps

- **Status:** Resolved
- **Severity:** Suggestion
- **Category:** Edge Case
- **Locations:** `memory-protection.env.ts`, `memory-protection.service.ts:45`
- **Technical explanation:** `positiveSafeInteger` admits values above
  2147483647 ms, but Node's `setInterval` clamps larger delays down to 1 ms —
  an implausible-but-accepted configuration would sample RSS every
  millisecond while `Retry-After` would advertise days.
- **Failure scenario:** operator pastes an unvalidated large value; CPU burns
  on a 1 ms sampling loop with no validation error.
- **Judge recommendation:** bound the schema field (e.g. 1 hour) consistent
  with the fail-fast posture.
- **Investigation results:** valid. Added `MAX_SAMPLE_INTERVAL_MS = 3_600_000`
  (1 hour) as a named constant bound on the schema field with the Node-clamp
  rationale in a comment, plus spec coverage for the bound.
- **Agreed resolution:** fixed.

### CR-03 — Module-level guard provider is dead weight (guard instantiated twice)

- **Status:** Resolved
- **Severity:** Suggestion
- **Category:** YAGNI/Clean Code
- **Locations:** `memory-protection.module.ts` vs `app.module.ts:37`
- **Technical explanation:** the only consumer is AppModule's `APP_GUARD`
  `useClass` registration, which builds its own instance; nothing injects the
  module-provided copy.
- **Failure scenario:** none at runtime; misleading to future readers.
- **Judge recommendation:** drop the guard from the module's
  providers/exports.
- **Investigation results:** valid. Guard removed from the module; ordering
  control stays in AppModule as documented.
- **Agreed resolution:** fixed.

### CR-04 — Expected 503 rejections log at error level as "Unhandled exception"

- **Status:** Resolved
- **Severity:** Suggestion
- **Category:** Observability/Error Handling
- **Locations:** `apps/api/src/shared/filters/problem-details.filter.ts:82-85`
- **Technical explanation:** every shed request and readiness-probe failure
  is a deliberate, bare `ServiceUnavailableException` without an attached
  cause, but the filter logs all ≥500 statuses at error level with
  "Unhandled exception" — under memory pressure, error logs fill with
  expected rejections indistinguishable from real failures.
- **Failure scenario:** on-call cannot separate load-shed 503 noise from
  genuine unhandled errors during an incident.
- **Judge recommendation:** warn-level branch for expected built-in 503s.
- **Investigation results:** valid, and root-caused in the shared filter per
  the fix-once rule: the error-level branch now requires an attached error
  (`normalized.error !== undefined`); deliberate bare 5xx HttpExceptions log
  at warn as `HTTP <status> <code>`. Unknown exceptions (which carry the
  original error) keep error-level logging with the stack. Spec case added
  for a bare 503 → warn.
- **Agreed resolution:** fixed.

**Wave 11 summary:** 4 findings — all Suggestion-level, all fixed (import
merge, interval bound + spec, dead provider removal, expected-503 warn branch

- spec). No Critical/High/Medium findings; the judge explicitly verified the
  state machine, timer lifecycle, guard ordering, filter contract, exemption
  resolution, i18n locale resolution inside guards, and the e2e override
  effectiveness. Re-review verdict recorded below.

**Wave 11 re-review (same reviewer):** `APPROVED` — all four remediations
verified at their locations (import merge, interval bound + boundary spec,
dead guard provider removed with its import, warn branch equivalent to
"unknown exception" so no genuine error-level visibility is lost); regression
check found no collateral damage; delegated validation results noted without
independent re-execution (read-only reviewer).

---

## Wave 12 — Task 3 (memory load shedding) security review (2026-11-13)

Review scope: identical to Wave 11. Verdict: `SECURITY_CHANGES_REQUIRED`
(1 actionable Low, 1 Low deployment-boundary, 3 informational) → SEC-01
remediated → re-review below.

### SEC-01 — Non-Error thrown values lose error-level logging entirely

- **Status:** Resolved
- **Severity:** Low
- **Category:** Security (CWE-778, insufficient logging of exceptions)
- **Locations:** `problem-details.filter.ts` (logging branch + normalize)
- **Technical explanation:** the Wave-11 CR-04 fix keys error-level logging
  on an attached `error`; `normalize()` only attaches `Error` instances, so a
  dependency rejecting with a non-Error (string/object) now logs a bare warn
  `HTTP 500 APPLICATION_ERROR` with no diagnostics — previously error level.
  Error throws (the realistic majority) are unaffected (e2e-verified by the
  reviewer).
- **Failure scenario:** incident caused by a non-Error rejection is invisible
  to error-level alerting.
- **Judge recommendation:** wrap non-Error thrown values so they retain
  error-level logging.
- **Investigation results:** valid. `normalize()` now wraps non-Error unknown
  values as `new Error(\`Non-Error value thrown (${typeof exception})\`)`—
  the thrown VALUE is never logged or echoed (no secret-leak surface; the
  pre-fix behavior also never logged the value), while the failure regains
  error-level visibility. Bare deliberate`HttpException`s keep warn logging.
  Spec case added: non-Error throw → error-level log, response contract
  unchanged, thrown value absent from the response.
- **Agreed resolution:** fixed.

### SEC-02 — Probe endpoints are an unthrottled, unauthenticated work path during shedding

- **Status:** Won't Fix (deployment-boundary mitigation; conscious acceptance)
- **Severity:** Low (CWE-400)
- **Category:** Security / resource amplification
- **Locations:** `health.controller.ts` (probe endpoints), `main.ts` (exposure)
- **Technical explanation:** `/health/ready` executes a Redis PING + Terminus
  aggregation per request, is unauthenticated, unthrottled, and exempt from
  shedding — during protection it is the most expensive endpoint an attacker
  can reach. The reviewer scoped it explicitly: `/health` already had this
  property; the reviewer's primary mitigation is deployment-level (restrict
  probe routes to the orchestrator network at ingress), with an optional
  in-process coarse limiter as defense-in-depth.
- **Judge recommendation:** ingress restriction; optional in-process limiter.
- **Investigation results:** not applied in code: an in-process limiter on
  probe routes risks rejecting legitimate orchestrator/LB probing
  configurations and would need its own throttling design — the correct layer
  is the deployment boundary (network policy / ingress), which is outside the
  repository. The exposure and recommendation are recorded here; revisit if a
  production ingress configuration lands in this repo.
- **Agreed resolution:** Won't Fix with the justification above; deployment
  guidance recorded.

### SEC-03 — `Retry-After` discloses the sampling cadence; protected-state disclosure is inherent

- **Status:** Won't Fix (inherent to load shedding)
- **Severity:** Informational (CWE-203)
- **Category:** Security / observable discrepancy
- **Locations:** `memory-protection.service.ts`, `memory-protection.guard.ts`
- **Technical explanation:** the 503 announces the protected state (the
  feature's purpose) and `Retry-After` reveals a seconds-rounded cadence
  hint; no thresholds, RSS values, config, or stacks leak (verified: body,
  headers, logs). Knowing the cadence does not help bypass shedding (state
  depends on RSS, not timing).
- **Judge recommendation:** none required; optionally document the advisory
  nature of the header.
- **Investigation results:** ADR-026 already defines the header as derived
  from the sampling interval; the advisory (non-promise) nature is implicit
  in the hysteresis design documented there. No change.
- **Agreed resolution:** Won't Fix.

### SEC-04 — No floor on MAX_RSS_MB / bound on STABLE_SAMPLES permits permanent shedding via misconfiguration

- **Status:** Won't Fix (operator-only, fails loudly)
- **Severity:** Informational (CWE-1188)
- **Category:** Security / configuration hardening
- **Locations:** `memory-protection.env.ts`, `env.config.ts` cross-field rule
- **Technical explanation:** a deployment setting MAX_RSS_MB below the
  process baseline (or a huge STABLE_SAMPLES) sheds from boot. The failure is
  loud, not silent: the sampler logs the activation warning immediately at
  bootstrap and the readiness endpoint fails 503 at the deploy gate, while
  liveness stays 200 (no restart loop). Environment-only values; no injection
  surface.
- **Judge recommendation:** optional minimum floor or startup warning below
  baseline.
- **Investigation results:** not applied: an arbitrary MB floor is a magic
  number that could conflict with legitimately small containers, and the
  fail-loud signal pair (warn log + readiness 503 at gate) already surfaces
  the misconfiguration immediately. Revisit if a real deployment hits it.
- **Agreed resolution:** Won't Fix with the justification above.

### SEC-05 — One warn line per rejected request while shedding

- **Status:** Won't Fix (log-volume trade-off accepted)
- **Severity:** Informational (CWE-400)
- **Category:** Security / log amplification
- **Locations:** `problem-details.filter.ts` warn branch
- **Technical explanation:** shed rejections log one warn line each; volume
  grows with attack rate. Pino throughput and the bounded json-file rotation
  (compose `x-logging`) bound the cost; per-request visibility during
  shedding is operationally valuable (shed rate is the incident signal).
- **Judge recommendation (optional):** sample or aggregate shedding
  rejections.
- **Investigation results:** not applied: aggregation would hide the very
  rate the on-call needs during an incident; storage is bounded by the
  existing log rotation. Revisit with the monitoring stack if ingestion cost
  becomes real.
- **Agreed resolution:** Won't Fix with the justification above.

**Wave 12 summary:** 5 findings — 1 actionable Low (SEC-01, fixed:
non-Error wraps preserve error-level logging without logging the value), 1
Low (SEC-02, Won't Fix: deployment-boundary mitigation recorded), 3
informational (SEC-03/04/05, Won't Fix with justification). No
Critical/High/Medium; no injection, access-control, deserialization, or
secret-exposure weaknesses. Re-review verdict recorded below.

**Wave 12 re-review (same reviewer):** `SECURITY_APPROVED_WITH_INFORMATIONAL_FINDINGS`
— SEC-01 verified fixed (error-level visibility restored, no value echo,
deliberate 503s still warn, genuine Errors unchanged); SEC-02–05 dispositions
reviewer-concurred ("nothing above was downgraded to obtain approval"); no
OPEN code-level security weakness remains in scope.

---

## Wave 13 — MikroORM v7 + PostgreSQL integration, first code review (2026-11-14)

Review scope: the _040 integration (config layer, `src/shared/database/`, health wiring, CLI config, tests, compose overrides, env files) plus the follow-up _041 shutdown/resilience implementation. Verdict: `CHANGES_REQUIRED` — 2 WARNING, 4 SUGGESTION, 0 Critical. All six findings investigated; every remediation is an implementation detail of the already-approved ADR-027 (and its approved amendment), so none required a separate approval gate. All six resolved.

### CR-01 — Quoted password embedded mid-URL in `.env.development`

- **Status:** Resolved
- **Severity:** WARNING (High impact on the affected workflow)
- **Category:** Correctness
- **Locations:** `apps/api/env/.env.development` (`DATABASE_URL`)
- **Technical explanation:** `--env-file` strips surrounding quotes only when the whole value is quoted; a password quoted mid-URL stays literal, so host-local development authenticated with the quote characters included while the Compose container used the unquoted value. `new URL()` accepts `"` in userinfo, so the Zod schema cannot catch it.
- **Judge recommendation:** remove the inner quotes; quote only the whole value if ever needed.
- **Investigation results:** confirmed; additionally the role itself had been aligned with the quoted value by an earlier `ALTER USER`, compounding the mismatch (caught by the scenario-B verification run).
- **Agreed resolution:** `.env.development` rewritten with the unquoted password; the postgres role re-aligned to the same unquoted value. Quoting guidance added to `docker/env/.env.docker.example`.

### CR-02 — Health probe runs two `select 1` per probe

- **Status:** Resolved
- **Severity:** SUGGESTION (Low, Performance)
- **Category:** Performance
- **Locations:** `src/shared/database/database.health.ts` (`probe`)
- **Technical explanation:** `isConnected()` internally executes `checkConnection()` in v7, so guarding with it doubled the highest-frequency endpoints' query cost; the class doc also misstated the cost.
- **Judge recommendation:** call `connect()` unconditionally, then `checkConnection()` once.
- **Investigation results:** confirmed against `AbstractSqlConnection.js` (v7 `isConnected()` → `checkConnection()`); `connect()` is idempotent and its dialect creation is synchronous, so the unconditional call is safe under concurrent probes.
- **Agreed resolution:** applied; comment updated to state the one-query contract. Specs updated accordingly.

### CR-03 — CLI `db:migration:*` scripts have no build prerequisite

- **Status:** Resolved
- **Severity:** WARNING (Medium operational)
- **Category:** Edge Case (stale compiled output)
- **Locations:** `apps/api/package.json` scripts, `#config/*` alias (`default` → `dist/`)
- **Technical explanation:** the CLI loads the TS config via the swc loader, but `#` specifiers resolve through Node's package-imports map to `dist/`; without a build the scripts crash on a fresh clone or silently validate against a stale schema.
- **Judge recommendation:** add a build prerequisite or document it.
- **Investigation results:** both options viable; the build prefix is ~1–2 s (SWC) and eliminates both failure modes.
- **Agreed resolution:** `pnpm build &&` prefixed to all three `db:migration:*` scripts.

### CR-04 — Compose interpolation cannot percent-encode the password into the URL

- **Status:** Resolved
- **Severity:** SUGGESTION (Low, Edge Case)
- **Category:** Edge Case (configuration)
- **Locations:** `docker/compose.app.dev.yml`, `docker/compose.app.prod.yml` (`DATABASE_URL`), `docker/env/.env.docker.example`
- **Technical explanation:** an operator password containing `@ : / ? # %` breaks or mangles the interpolated URL, and Zod validation cannot reliably reject every mangling.
- **Judge recommendation:** document the URL-safety constraint where the password is defined.
- **Investigation results:** the constraint is a documented requirement, not a code change.
- **Agreed resolution:** constraint added to the `POSTGRES_PASSWORD` comment in `docker/env/.env.docker.example` (hex output suggested).

### CR-05 — Probe timeout equals the Compose healthcheck timeout

- **Status:** Resolved
- **Severity:** SUGGESTION (Low, Edge Case)
- **Category:** Edge Case (timeout tuning)
- **Locations:** `database.health.ts` (`DATABASE_HEALTH_PROBE_TIMEOUT_MS`), Compose api healthcheck (`timeout: 5s`)
- **Technical explanation:** with Redis and PostgreSQL both black-holed, liveness latency could reach ~5 s — exactly the outer Docker timeout — and mark a live container unhealthy.
- **Judge recommendation:** keep the inner bound strictly below the outer timeout.
- **Investigation results:** confirmed; Terminus executes indicators concurrently so worst case ≈ the largest inner bound.
- **Agreed resolution:** probe timeout lowered to 3000 ms with a comment stating the relationship; spec assertions updated.

### CR-06 — Runtime ORM options shape duplicated across module and two test helpers

- **Status:** Resolved
- **Severity:** SUGGESTION (Low, Syntax/Code Quality)
- **Category:** Syntax/Code Quality
- **Locations:** `database.module.ts`, `test/create-test-app.ts`, `test/database.db-spec.ts`
- **Technical explanation:** three hand-built copies of `{driver, ...options, autoLoadEntities}` silently drift when the runtime factory changes.
- **Judge recommendation:** export a single runtime options builder and use it everywhere.
- **Investigation results:** applied as `buildRuntimeMikroOrmOptions(url)` next to `buildMikroOrmOptions` (which remains CLI-only); the driver still rides along in overrides that replace the whole options object, matching the module's beside-`useFactory` supply.
- **Agreed resolution:** applied.

**Wave 13 summary:** 6 findings — 2 WARNING (both resolved: CR-01 real credential-mismatch bug fixed, CR-03 fresh-clone/stale-schema tooling trap fixed), 4 SUGGESTION (all resolved). No Critical, no security-category findings; the reviewer explicitly verified the v7 API usage, probe concurrency, Terminus semantics, secret handling, env schema, test override mechanics, and i18n parity against installed dependency sources.

**Wave 13 re-review (same reviewer):** verdict `CHANGES_REQUIRED` on the _041 shutdown/connection-resilience code. CR-01…CR-06 all verified **FIXED** with file-level evidence. Two new findings:

### CR-07 — Initializer treats `orm.connect()` as the dialing operation

- **Status:** Resolved
- **Severity:** BLOCKER (as reported)
- **Category:** Correctness
- **Locations:** `src/shared/database/database.connect.ts` (attempt body), `test/database.db-spec.ts` (startup-failure scenario)
- **Technical explanation:** the reviewer's source reading: v7 `orm.connect()` → `DatabaseDriver.connect()` → `AbstractSqlConnection.connect()` → `initClient()` (synchronous lazy-pool creation) + `onConnect()` (no-op without the schema-generator extension) — concluding the retry machinery is unreachable and boot would succeed without the database. **Investigation result — premise disproven by executed verification:** the attempt _did_ dial the server in every real run. The dial comes from the registered **Migrator extension**: `Migrator.init()` (`@mikro-orm/migrations` `Migrator.js:47-52`) calls `this.#schemaGenerator.ensureDatabase()`, which executes `PostgreSqlSchemaHelper.databaseExists` (`SchemaHelper.js:780`) — the exact frame chain in the captured ECONNREFUSED stacks (`/tmp/scenario-c.log`). Evidence: Scenario B (2 refused attempts → established on attempt 3 after Postgres started), Scenario C (exactly 5 failures → `PostgreSQL connection failed after 5 attempts`, exit 1, HTTP never started), Scenario D (28P01 → immediate non-retried failure), and the `test:db` startup-failure test passing against a real closed port (4/4). The reviewer's own restriction ("no tests were executed") is where the premise went wrong.
- **Judge recommendation:** make each attempt contact the server explicitly — `connect()` + `checkConnection()`, throwing the preserved pg error so classification and tests stay valid.
- **Agreed resolution:** the hardening is **accepted on its own merits**: the implicit dial depended on a Migrator side effect that may change across versions, so the attempt now connects and explicitly verifies via `checkConnection()`, throwing `result.error ?? new Error(result.reason)` (SQLSTATE classification intact). Failure modes in the unit specs moved onto `checkConnection`, a `{ok:false,error}`-shape classification test was added, and comments state the deliberate contract. The dispute and the executed evidence are recorded here so the finding is neither silently discarded nor silently accepted as a defect.

### CR-08 — Failed-boot scenario leaks a half-initialized app

- **Status:** Resolved
- **Severity:** SUGGESTION (Low)
- **Category:** Edge Case (test hygiene / partial-failure resources)
- **Locations:** `test/database.db-spec.ts` (startup-failure scenario), `test/create-test-app.ts`
- **Technical explanation:** `createTestApp` cannot hand back an app when `init()` rejects, so providers initialized before the failure (Redis client reconnect loop, ORM pool) stayed alive for the worker's lifetime.
- **Judge recommendation:** give the scenario a teardown path (or document the leak).
- **Agreed resolution:** the scenario boots inline (`Test.createTestingModule` + Fastify adapter, init before any HTTP behavior matters) and calls `app.close()` in a `finally`, shutting down the partially initialized providers.

**Wave 13 third round:** the CR-07 hardening and CR-08 teardown were re-submitted for review. Verdict: **`APPROVED`** — CR-07 **RESOLVED** (explicit `checkConnection()` per attempt verified against the installed sources as server contact independent of the side effect; SQLSTATE classification preserved via `result.error`; attempt timeout bounds connect + check; rewritten specs match the control flow) and CR-08 **RESOLVED** (inline boot + `finally` teardown verified to run the shutdown lifecycle on the partially initialized providers). No new issues introduced. The reviewer also issued a **factual record correction**: the round-2 CR-07 premise was wrong — `ensureDatabase: true` is the factory default, `AbstractSqlPlatform.init` registers the schema-generator extension, and `Connection.onConnect → SqlSchemaGenerator.ensureDatabase → databaseExists` is the connect-time dial path (the `Migrator.init` call sites attributed in the dispute record are migration operations, not connect) — confirming the material dispute: the implicit dial existed, the shipped behavior satisfied the contract, and the hardening removes the dependence on that library default. Two round trips per successful boot attempt (ORM default probe + verification `select 1`) were assessed inherent to leaving the ORM default in place and not actionable.

---

## Wave 14 — PostgreSQL integration security review (2026-11-14)

Review scope: identical to Wave 13 (database module, config layer, health wiring, tests, compose wiring, env files) from an attacker's perspective, with CWE classification. Verdict: `SECURITY_CHANGES_REQUIRED` — 2 LOW, 1 INFORMATIONAL, 0 Critical/High/Medium. Clean areas explicitly verified: credential flow (no URL/password in logs, validation errors, or Problem Details), injection surface (constant `select 1`, fixed SQLSTATE set), retry bounds, test-only wiring isolation, compose credential handling, exact-pinned ORM dependencies.

### SEC-01 — Unauthenticated `/health` disclosed internal DB failure state via raw error passthrough

- **Status:** Resolved
- **Severity:** LOW
- **Category:** Security
- **CWE:** CWE-209 (secondary CWE-200)
- **Locations:** `src/shared/database/database.health.ts` (`failureMessage` passthrough), consumed by `GET /health`
- **Technical explanation:** the raw pg error message (and `checkConnection` reason) reached the unauthenticated liveness body: `28P01` leaked the DB username, `3D000` the database name, `ECONNREFUSED` the internal hostname/port — letting callers fingerprint internal failure classes, violating the repository's own indistinguishable-failures rule.
- **Judge recommendation:** generic localized message client-side; raw reason/error server-side logs only.
- **Agreed resolution:** applied — the indicator now reports only `health.databaseUnavailable` (localized) for every failure class on both endpoints, and logs the raw reason/error through the Pino logger. Specs updated to assert the generic contract.

### SEC-02 — Health probes create uncancellable pool backlog on black-hole failures

- **Status:** Resolved
- **Severity:** LOW
- **Category:** Security
- **CWE:** CWE-400
- **Locations:** `database.health.ts` (`probe`), `database.timeout.ts` (abandon-not-cancel), `mikro-orm.options.ts` (no pool timeout)
- **Technical explanation:** pg's `connectionTimeoutMillis` defaults to 0 (indefinite); timed-out probes left pending pool acquisitions/queued queries that nothing cancels, and the health endpoints are exempt from both guards — the one request class able to grow process memory without shedding, plus connection-slot pressure on PostgreSQL.
- **Judge recommendation:** set the pool timeout via the existing `driverOptions` knob; optionally serialize probes or cache results.
- **Agreed resolution:** applied — `driverOptions.connectionTimeoutMillis = 5000` in `buildMikroOrmOptions` (verified to flow `driverOptions → createKyselyDialect → mapOptions → new Pool`), bounded above the 3s probe so callers experience the probe timeout while the pool still reclaims every abandoned attempt. Probe serialization/caching not implemented (YAGNI: the bounded pool removes the unbounded growth; revisit only with evidence).

### SEC-03 — Development Compose publishes PostgreSQL/Redis ports on all host interfaces

- **Status:** Await Approval
- **Severity:** INFORMATIONAL
- **Category:** Security
- **CWE:** CWE-16 (Configuration)
- **Locations:** `docker/compose.app.dev.yml` (postgres/redis/insight host port bindings)
- **Technical explanation:** the same file binds MockServer to loopback deliberately; the password-protected database ports default to `0.0.0.0`, exposing dev infrastructure to LAN networks. No realistic attack path with authentication enabled — hardening only.
- **Judge recommendation:** bind dev infrastructure ports to `127.0.0.1` like MockServer.
- **Agreed resolution:** presented to the developer for approval (developer workflow choice: other LAN devices may rely on host access).

**Related note (outside this wave's scope):** `RedisHealthIndicator` passes raw ioredis error messages through the same health contract (topology disclosure class as SEC-01). Recorded for the developer's decision — same remediation pattern applies.

**Wave 14 summary:** 3 findings — 2 LOW resolved (generic health messages; pool-level connection timeout), 1 informational awaiting developer approval (loopback dev port bindings). Redis indicator parity flagged for the same decision. No Critical/High/Medium; credential flow, injection, retry bounds, test isolation, and supply chain verified clean.

**Wave 14 resolutions (developer-approved):** SEC-01 parity applied — `RedisHealthIndicator` now reports only the generic localized `health.redisUnavailable` message with raw errors logged server-side (specs updated; e2e asserts statuses only, unaffected). SEC-03 applied — dev Compose postgres/redis/insight host ports bound to `127.0.0.1` (MockServer precedent). Final security status after remediation: all findings Resolved; re-review of the two LOW remediations is available on request — the changes follow the reviewer's own recommendations verbatim and are covered by updated specs.

---

## Wave 6 — ADR-028 pgAdmin dev-infrastructure review (2026-11-15)

Context: code-reviewer gate over the ADR-028 implementation (compose service,
render script, template, env files, docs, ADR). Verdict CHANGES_REQUIRED with
three warnings (CR-01–CR-03) and two suggestions (CR-04–CR-05). All five
findings investigated and accepted; none changes the approved design
(ADR-028), so per the root AGENTS.md "minor implementation details" exception
they were applied directly, re-validated at runtime (recreated container,
render + registration re-check), and re-reviewed by the same reviewer.

### F1 — Credential values interpolated into JSON without escaping (CR-01)

- **Status:** Resolved (2026-11-15)
- **Severity:** Medium (reviewer warning)
- **Category:** Correctness / Edge Case
- **Locations:** `docker/pgadmin/render_servers.py` (substitution), `docker/pgadmin/servers.json.template` (`Password` placeholder)
- **Technical explanation:** the substitution inserted raw environment values into JSON text and only validated afterwards. A `POSTGRES_PASSWORD` containing `"` or `\` — permitted by the documented interpolation constraint, which excludes only `@ : / ? # %` for `DATABASE_URL` — would either break the JSON with a raw traceback or, in a contrived embedding, silently register a truncated password or altered keys.
- **Failure scenario:** a developer picks a password the env-file guidance permits but that contains a double quote → the pgadmin container dies at startup with a `JSONDecodeError` traceback instead of the documented explicit error; the silent variant registers a broken connection discovered only at first use.
- **Judge recommendation:** escape every substituted value for JSON string context (`json.dumps(value)[1:-1]`) and wrap `json.loads` in try/except re-raising as `SystemExit` naming the template.
- **Investigation results:** valid. The documented password constraint exists for `DATABASE_URL` interpolation and does not exclude `"`/`\`, so the render must be robust for any value. Escaping is a pure robustness fix inside the approved Option-A mechanism: values still flow exclusively from the environment and the rendered output remains JSON.
- **Agreed resolution:** applied — substitutions are JSON-escaped via `json.dumps(...)[1:-1]`; `json.JSONDecodeError` is re-raised as `SystemExit` with the parse error; the write is guarded against `OSError` with the destination path in the message (no secret content is ever printed).

### F2 — Prompt record referenced by ADR-028 did not exist (CR-02)

- **Status:** Resolved (2026-11-15)
- **Severity:** Medium (reviewer warning)
- **Category:** Correctness (project process)
- **Locations:** `DECISIONS.md` ADR-028 References; `prompts/_044-pgadmin-dev-infrastructure.md`
- **Technical explanation:** the ADR referenced the feature record before it was created (the record was scheduled for the finalization phase of the same task, so the reference dangled at review time).
- **Failure scenario:** committed ADR pointing at a nonexistent file; the feature's record missing from the deliverable.
- **Judge recommendation:** create the record before committing.
- **Investigation results:** valid — record creation had not happened yet at review time.
- **Agreed resolution:** applied — `prompts/_044-pgadmin-dev-infrastructure.md` created in the same task with the original request, phases, decisions, and validation results.

### F3 — Contradictory claims about password persistence in the named volume (CR-03)

- **Status:** Resolved (2026-11-15)
- **Severity:** Medium (reviewer warning)
- **Category:** Correctness (documentation)
- **Locations:** `DECISIONS.md` ADR-028 Security Assessment; `docker/compose.app.dev.yml` (`PGADMIN_SERVER_JSON_FILE` comment); contradicted by `docs/docker.md` (stale-password troubleshooting)
- **Technical explanation:** the rendered `/tmp` file never reaches the volume, but pgAdmin imports the server definition — including the password — into its configuration database (SQLite under `/var/lib/pgadmin`) on first launch; that is exactly how registration survives recreation. The ADR/compose wording ("keeps the password out of the persistent volume") was therefore wrong and inconsistent with `docs/docker.md`'s stale-password note.
- **Failure scenario:** a future reader reasons about volume lifecycle (backups, `down -v` semantics) from the wrong fact.
- **Judge recommendation:** reword the ADR Security Assessment and compose comment: the rendered file is transient container-local scratch, and pgAdmin persists the imported password in its config DB on the volume by design.
- **Investigation results:** valid; `docs/docker.md` already stated the correct fact — the ADR/compose wording was inaccurate, not the design.
- **Agreed resolution:** applied — both wordings corrected to the factual model (transient render file; imported password persisted inside the configuration database on `pgadmin_data` by design; deleting the volume purges it).

### F4 — Render script hardcodes the output path, contradicting its documented contract (CR-04)

- **Status:** Resolved (2026-11-15)
- **Severity:** Low (reviewer suggestion)
- **Category:** Syntax / Code Quality
- **Locations:** `docker/pgadmin/render_servers.py` (`RENDERED_PATH`); `docker/compose.app.dev.yml` (`PGADMIN_SERVER_JSON_FILE`)
- **Technical explanation:** the docstring claimed the file is written "to the path `PGADMIN_SERVER_JSON_FILE` points at" while the path was hardcoded, duplicating the compose value in a second place; changing the compose variable would leave pgAdmin reading a nonexistent file with no render error.
- **Failure scenario:** latent misconfiguration after a path change — auto-registration silently skipped.
- **Judge recommendation:** derive the path from `os.environ.get('PGADMIN_SERVER_JSON_FILE', '/tmp/servers.json')`.
- **Investigation results:** valid; restores the documented contract and a single source of truth for the path.
- **Agreed resolution:** applied — the script reads `PGADMIN_SERVER_JSON_FILE` with the `/tmp/servers.json` default, and an unwritable destination aborts with an explicit error.

### F5 — `.env.docker.dev` comment cites variables not present in the file (CR-05)

- **Status:** Resolved (2026-11-15)
- **Severity:** Low (reviewer suggestion)
- **Category:** Syntax / Code Quality
- **Locations:** `docker/env/.env.docker.dev` (pgAdmin comment block; gitignored file)
- **Technical explanation:** the comment said the omitted `PGADMIN_PORT` matches `REDIS_INSIGHT_PORT/MOCKSERVER_PORT` "above", but those variables are not defined in the dev file (they also rely on compose defaults).
- **Failure scenario:** developer confusion about the file's structure.
- **Judge recommendation:** reword or drop the comparison.
- **Investigation results:** valid.
- **Agreed resolution:** applied — comment reworded to state the omission without implying the variables are defined in the file.

**Wave 6 summary:** 5 findings — 3 Medium resolved (JSON escaping, missing prompt record, volume/password wording contradiction), 2 Low resolved (path contract, env-comment wording). No Critical/High. The approved ADR-028 design is unchanged; fixes were re-validated by recreating the container and re-checking the render and registration, and the revised render script was re-reviewed.

### Wave 6 security review (2026-11-15) — SECURITY_APPROVED_WITH_INFORMATIONAL_FINDINGS

Independent security gate over the remediated implementation. Four
informational findings, none with a realistic exploit path beyond an already
compromised host or container; positively confirmed sound: no credential
literals in any tracked file, injection through credential values into the
render not possible (single-pass `re.sub` with literal-function replacement +
JSON-string escaping + re-validation), shell injection through the static
`sh -c` entrypoint not possible, and all render failure paths are
secret-free (relevant because Alloy/ADR-022 collects the container's stdout
into Loki).

- **SEC-01 (informational, CWE-494):** image pinned by tag only; the verified digest is recorded in ADR-028 as documentation but not enforced at pull time. **Won't Fix (convention):** every service in the stack is tag-pinned only; digest-pinning compose references repo-wide is a separate developer decision, not a pgAdmin-specific gap. Recorded as an optional stack-wide hardening candidate.
- **SEC-02 (informational, CWE-256):** `PGADMIN_CONFIG_MASTER_PASSWORD_REQUIRED=False` removes the user-chosen key encrypting saved server passwords, so at-rest protection of the imported password on `pgadmin_data` degrades to filesystem access. **Won't Fix (accepted trade-off):** UI authentication stays enabled; an attacker with volume read access already has the same password in plaintext via `docker inspect` or the postgres container; dev-only credentials; deleting the volume purges them. Removing the override would reintroduce a manual prompt (the UX the design rejected).
- **SEC-03 (informational, CWE-312):** the dev PostgreSQL password exists in plaintext in the container environment, the transient `/tmp/servers.json`, and (encrypted) in pgAdmin's config DB on the volume. **Won't Fix (accepted, documented):** mirrors the accepted exposure of every other dev service carrying the same credentials in env; container is non-root, mounts read-only, the rendered file is per-container scratch, and ADR-028/`docs/docker.md` document the volume-purge path.
- **SEC-04 (informational, CWE-521):** no password-generation guidance for `PGADMIN_DEFAULT_PASSWORD` in the tracked example file, while the admin login is reachable from sibling containers (lateral-movement hardening). **Resolved (2026-11-15):** the example-file comment now carries the same `openssl rand -hex 24` generation hint as `POSTGRES_PASSWORD` and notes sibling-container reachability.

---

## Wave 15 — Shared BaseEntity, actor context, UTC policy code review (2026-11-15)

Context-blind judge review of `apps/api/src/shared/database/base.entity.ts`,
`src/shared/actor-context/*`, `src/shared/errors/error.code.ts`,
`optimistic-lock.mapper.ts`, `src/shared/datetime/utc-datetime.ts`,
`src/modules/app/app.module.ts`, the en/fa `errors.json` catalogs, and the
unit + db-tier specs. Final status of the wave before remediation:
`CHANGES_REQUIRED` — 1 Medium, 2 Low, no Critical/High.

### CR-01 — `parseLocalDate` accepts semantically invalid dates; boundary math silently targets the wrong calendar day

- **Status:** Resolved (2026-11-15)
- **Severity:** Medium
- **Category:** Edge Case
- **Locations:** `apps/api/src/shared/datetime/utc-datetime.ts` (`LOCAL_DATE_PATTERN`, `parseLocalDate`, `startOfLocalDayUtc`, `nextLocalDay`)
- **Technical explanation:** validation was shape-only (`/^\d{4}-\d{2}-\d{2}$/`); `Date.UTC` silently normalizes `'2026-02-30'` → 2026-03-02, `'2026-13-01'` → 2027-01-01, and maps years 0–99 to 1900–1999, so invalid input sometimes throws and sometimes produces a plausible wrong result.
- **Failure scenario:** a future caller validates user input against the same shape rule and passes `'2026-02-30'`; every derived report silently shifts by days (or a century for years 0000–0099).
- **Judge recommendation:** round-trip the components through `Date.UTC`/`getUTC*` before use and reject years below 100.
- **Investigation results:** valid — real correctness gap with a concrete silent-failure path.
- **Agreed resolution:** applied — `parseLocalDate` now rejects years 0–99 explicitly and `startOfLocalDayUtc` verifies the parsed components round-trip (`getUTCMonth()/getUTCDate()`), throwing the existing `Invalid local date` error otherwise. Spec extended with the rollover rejections.

### CR-02 — Documented skipped-midnight DST behavior is untested

- **Status:** Resolved (2026-11-15)
- **Severity:** Low
- **Category:** Correctness (coverage gap)
- **Locations:** `apps/api/src/shared/datetime/utc-datetime.ts` (`startOfLocalDayUtc` loop), `utc-datetime.spec.ts`
- **Technical explanation:** the doc comment promises the transition instant when DST removes local midnight, but every covered zone transitions away from midnight, so the third refinement pass (the only one exercising skipped midnight) was never pinned; a cap regression would pass the suite while shifting boundaries an hour.
- **Failure scenario:** a regression lowering the loop cap silently returns wrong day boundaries for midnight-transition zones.
- **Judge recommendation:** assert `calendarDayUtcRange('2024-09-08', 'America/Santiago')` → `2024-09-08T04:00:00.000Z` (and the fall-back counterpart).
- **Investigation results:** valid.
- **Agreed resolution:** applied — both midnight-transition tests added (spring-forward 2024-09-08 and fall-back 2024-04-06 for America/Santiago).

### CR-03 — Stale comment: `ServiceUnavailable` also rides the status-based title fallback

- **Status:** Resolved (2026-11-15)
- **Severity:** Low
- **Category:** Syntax / Code Quality
- **Locations:** `apps/api/src/shared/errors/error.code.ts` (`ERROR_CODE_TITLE_KEYS` comment)
- **Technical explanation:** the comment claimed only `BadRequest`/`NotFound` lack application-specific title keys; `ServiceUnavailable` is equally absent and resolves through `errors.status.serviceUnavailable`.
- **Failure scenario:** a maintainer builds an invariant on the comment's incomplete list.
- **Judge recommendation:** correct the comment.
- **Investigation results:** valid (pre-existing inaccuracy, touched section).
- **Agreed resolution:** applied — comment lists all three codes.

**Wave 15 summary:** 3 findings — 1 Medium + 2 Low, all resolved. Revised files re-validated by the full unit suite (43 files / 364 tests green) and re-reviewed by the same judge (see Wave 15 re-review below).

### Wave 15 re-review (2026-11-15)

Same judge, revised code. CR-01 verified with independent traces of every
rejection path (rollover, month/day 0, year<100, year-100 boundary);
CR-02 verified by hand-deriving both Santiago transitions from the
fixed-point iteration (third-pass convergence genuinely pinned);
CR-03 verified against the actual map contents. No new findings.
**Status: APPROVED.**

## Wave 15 security review (2026-11-15)

Independent security gate over the approved implementation. 1 Low + 3
Informational findings; trust boundaries, audit-field integrity, optimistic
locking, information leakage, injection, and middleware registration all
positively verified sound (grep-verified: no production caller of
`calendarDayUtcRange`, no production `extends BaseEntity` outside specs, no
production import of test fixtures).

- **SEC-01 (Low, CWE-770):** `WALL_CLOCK_FORMATTER_CACHE` keyed by raw zone strings — case variants of valid zones are distinct keys, so client-derived zones would grow the map without bound once a feature wires them in (latent; no production caller today). **Resolved (2026-11-15):** the cache canonicalizes first — `new Intl.DateTimeFormat('en', { timeZone }).resolvedOptions().timeZone` collapses every case variant to one entry, invalid zones throw before caching.
- **SEC-02 (Informational, CWE-20):** `runWithActorContext` accepts any string as actor id and the seam is a stub. **Won't Fix (deferred by design):** unreachable today (seam returns `null`, no production caller); validation of the verified principal and encapsulation of the writer path belong to the authentication task that fills the seam — recorded as a requirement for that task, not implementable against a stub.
- **SEC-03 (Informational, CWE-20):** malformed `:id` path values reach Postgres as parameterized comparisons and surface as generic 500s. **Won't Fix (test-only):** the affected controller is the test-only probe fixture; the finding itself notes no production route exists. Route-level id validation is a requirement for the first entity-backed endpoints.
- **SEC-04 (Informational, CWE-778):** the middleware→ORM-write composition (actor established only by the middleware, not a nested context) is untested because the seam resolves `null`. **Won't Fix (deferred by design):** untestable until the seam resolves a real actor; the authentication task must add one db-tier test asserting a middleware-resolved actor lands in `createdBy`/`updatedBy`.

### Wave 15 security re-review (2026-11-15)

SEC-01 verified FIXED (canonicalization precedes every cache operation;
key space = finite canonical IANA zone set; behavior unchanged; no new
attack surface). SEC-02/03/04 remain OPEN Informational with their
future-task requirements recorded above.
**Status: SECURITY_APPROVED_WITH_INFORMATIONAL_FINDINGS.**

---

## Wave 16 — nestjs-cls actor context (ADR-031) reviews (2026-11-15)

Context-blind code review of the rewritten `src/shared/actor-context/` bridge,
`actor-context.module.ts` (`ClsModule.forRoot`), the `app.module.ts` swap, the
two new probe endpoints, and the new db-spec describe block. The reviewer
independently verified every library assumption against installed sources
(`nestjs-cls` ALS/globalThis sharing, symbol-key setter branch, Fastify 5
mount point, no-op auto-registered guard/interceptor, `EntityManager#id`
contextual resolution). One Low finding.

### CR-01 — Stale doc comment referenced the removed `ActorContextMiddleware`

- **Status:** Resolved (2026-11-15)
- **Severity:** Low
- **Category:** Syntax / Code Quality
- **Locations:** `apps/api/test/fixtures/test-article.controller.ts` (`actingAs` JSDoc)
- **Technical explanation:** the comment pointed at the deleted bespoke middleware; the seam now lives in the `ClsMiddleware` setup hook.
- **Failure scenario:** a future reader recreating a bespoke middleware alongside the CLS module would reintroduce the dual-mechanism state this change removed.
- **Judge recommendation:** reword to the current seam.
- **Investigation results:** valid.
- **Agreed resolution:** applied — comment now points at the ClsMiddleware setup hook.
- **Verdict:** APPROVED_WITH_SUGGESTIONS → finding applied; no re-review needed (comment-only).

## Wave 16 security review (2026-11-15) — SECURITY_APPROVED_WITH_INFORMATIONAL_FINDINGS

Independent security gate over the nestjs-cls integration. Trust boundary,
store retention (`saveReq`/`saveRes` off is load-bearing), injection safety
(symbol keys immune to prototype pollution), DoS (WeakMap/per-request store
lifecycle), CLS-vs-RequestContext isolation, and module mechanics all
positively verified sound against installed library sources. Two
Informational findings, both comment-level contracts applied:

- **SEC-01 (Informational, CWE-639-adjacent):** exported `runWithActorContext` can set arbitrary attribution — no production caller today. **Resolved (2026-11-15):** trust contract documented on the export (verified principals only; never client input).
- **SEC-02 (Informational, CWE-1188 class):** ordering trap — Nest middleware runs before guards, so a guard-populated `request.user` would not exist in the `setup` hook; a header-based fallback would become attribution forgery. **Resolved (2026-11-15):** the seam comment now states the mechanism — when authentication lands, the auth guard writes the verified principal into the store after verification; `setup` only opens the store with the system default.

## Wave 17 — post-report diff review (caveman-review, 2026-11-15)

Terse self-review of the full uncommitted `_047`+`_048` diff (requested by the
developer: `caveman-review` + "review diff") after both waves closed. Seven
findings; all applied the same day:

- **R-17-1 (High, doc drift):** `docs/current-state.md` named the deleted bespoke `ActorContextMiddleware` (+ "AsyncLocalStorage") in the actor bullet — the seam is now the nestjs-cls `ClsModule` middleware (ADR-031). **Resolved:** bullet rewritten.
- **R-17-2 (High, doc drift):** same stale class reference in Known Technical Limitations. **Resolved:** now points at `resolveActorId` in `actor-context.module.ts`.
- **R-17-3 (Medium, doc drift):** accepted-ADR status list stopped at ADR-030; ADR-031 missing. **Resolved:** appended.
- **R-17-4 (Medium, test robustness):** `test/base-entity.db-spec.ts` concurrent-actor chains shared the global `EntityManager` without a fork — one chain's `em.create` could land in the other's in-flight flush (cross-attribution hazard; the exact behavior under test). **Resolved:** each chain now flushes its own `em.fork()`. Test remains unexecuted (db tier pending Docker).
- **R-17-5 (Low, robustness):** `startOfLocalDayUtc` fixed-point loop could exit after the 3-pass cap without convergence, returning a wrong boundary silently. **Resolved (with a corrected premise):** the original recommendation (throw on non-convergence) was wrong — a skipped local midnight has no fixed point; the candidates oscillate across the transition (America/Santiago 2024-09-08: 04:00Z ↔ 03:00Z) and the 3-pass cap lands on the correct transition instant. The naive convergence throw regressed the suite (caught immediately by the Santiago spec). Final fix: early return on true convergence, and after the cap assert the final candidate is a zone transition (offset changes at that millisecond) — loud failure only for genuinely broken results, preserving the oscillation semantics.
- **R-17-6 (Low, doc drift):** db-spec test count said 9 (now 11). **Resolved.**
- **R-17-7 (Low, style):** duplicate imports from `@mikro-orm/decorators/legacy` in `base.entity.spec.ts`. **Resolved:** merged.

## Wave 18 — NodeAdapter platform migration review (2026-11-15)

Context-blind judge review (APPROVED_WITH_SUGGESTIONS) of the Fastify → NodeAdapter
migration (ADR-032): bootstrap, request-ID lifecycle, HTTP boundary contracts,
not-found fallback, envelope/filter/guard re-typing, test factory. 0 Critical,
0 High, 0 Medium, 6 Low. The judge independently verified the risky mechanisms
against the installed adapter sources (done-once hook protocol, not-found
mounting order, parser registration, 413 semantics, HEAD/204/304, pino reqId).

### CR-01 — `resolveApiVersion` misreports `neutral` for version-root URLs with a query string

- **Status:** Resolved (2026-11-15)
- **Severity:** Low
- **Category:** Edge Case/Correctness
- **Locations:** `apps/api/src/shared/http/api-version.ts:5`; consumers in the envelope interceptor, request-id lifecycle, not-found fallback
- **Technical explanation:** `API_VERSION_PATTERN = /^\/api\/v(\d+)(?:\/|$)/` applied to the raw URL: for `GET /api/v1?x=1` the `?` satisfies neither `/` nor `$`, so the pattern misses and the consumer reports `apiVersion: "neutral"` for a request that routes to v1. Predates the migration (Fastify code passed the same raw URL); the re-typed consumers re-cemented it in three places.
- **Failure scenario:** identical version-root requests with and without a query string return different user-visible `apiVersion` metadata in the envelope/Problem Details.
- **Judge recommendation:** normalize inside `resolveApiVersion` (single fix point) by stripping the query/fragment before matching.
- **Investigation results:** confirmed against the pattern and the three consumers; fix is one line in `resolveApiVersion`, no behavioral change for existing tested paths (the `/api/v1/...` and root-path cases already matched).
- **Agreed resolution:** applied — `resolveApiVersion` strips the query string (everything from the first `?`) before matching; HTTP request targets do not carry fragments.

### CR-02 — Inbound `x-request-id` normalization duplicated between accept/reject decision and ID resolution

- **Status:** Resolved (2026-11-15)
- **Severity:** Low
- **Category:** Syntax/Code Quality (DRY)
- **Locations:** `apps/api/src/shared/http/request-id.lifecycle.ts:40-41`; `apps/api/src/shared/http/request-id.ts:21-28`
- **Technical explanation:** the hook re-implements the exact "single value, else invalid" expression that `resolveRequestId` encapsulates; two copies of the accept decision can drift apart and break the never-echo-an-invalid-value pairing.
- **Failure scenario:** a future edit to one copy (trimming, comma handling) makes the hook reject an ID that `resolveRequestId` would reuse (or vice versa) with no type or test forcing sync.
- **Judge recommendation:** export one shared helper for resolving the inbound header value; both call sites consume it.
- **Investigation results:** straightforward extraction, no behavior change.
- **Agreed resolution:** applied — `readInboundRequestIdHeader(req)` exported from `request-id.ts`; used by `resolveRequestId` and the lifecycle hook.

### CR-03 — Dead commented-out code with a misleading comment

- **Status:** Resolved (2026-11-15; re-review confirmed the `request-id.ts` half, flagged the spec half as initially missed — the commented-out parameter was then replaced with a prose comment and the re-review verdict accepted it)
- **Severity:** Low
- **Category:** Syntax/Code Quality
- **Locations:** `apps/api/src/shared/http/request-id.ts:7-11`; `apps/api/src/shared/interceptors/response-envelope.interceptor.spec.ts:23-24`
- **Technical explanation:** `request-id.ts` carries a commented-out lowercase-only regex with an `info:` comment claiming the active pattern rejects uppercase — the active pattern compiles with `/i`, accepts uppercase, and its own unit test asserts that; the spec keeps a commented-out default parameter.
- **Failure scenario:** a reader trusting the `info` comment concludes uppercase UUIDs are rejected; dead code invites stale-copy confusion.
- **Judge recommendation:** delete the commented-out regex, the `info` comment, and the commented-out spec parameter.
- **Investigation results:** confirmed the comment is factually wrong about the shipped behavior.
- **Agreed resolution:** applied — dead code and misleading comment removed; the rejection-path comment now states the actual normalization behavior.

### CR-04 — Root not-found fallback silently depends on the request-ID lifecycle having run

- **Status:** Resolved (2026-11-15)
- **Severity:** Low
- **Category:** Edge Case/maintainability
- **Locations:** `apps/api/src/shared/http/not-found.fallback.ts` (`String(req.id)` at the response build)
- **Technical explanation:** the fallback reads `req.id`, which only exists because `registerRequestIdLifecycle` assigned it pre-routing; `req.id` is typed `unknown` on the boundary contract, so nothing forces the pairing.
- **Failure scenario:** a future bootstrap/test registering the fallback without the lifecycle produces `requestId: "undefined"` in the body and the `x-request-id` header on every root-level 404.
- **Judge recommendation:** state the pairing requirement in the interface doc, or derive the ID defensively via `resolveRequestId(req)`.
- **Investigation results:** both options viable; the defensive derivation is strictly better — self-sufficient, reuses the shared helper (CR-02's), and preserves ADR-010 semantics (fresh UUID when the lifecycle has not run) instead of encoding a broken value.
- **Agreed resolution:** applied — the fallback uses the lifecycle-assigned `req.id` when it is a valid UUIDv4 string (the normal path, keeping body/header consistency) and falls back to `resolveRequestId` otherwise, so a misconfigured bootstrap gets a real UUIDv4 instead of the literal `"undefined"`.

### CR-05 — Early 400 for an invalid `x-request-id` carries no CORS headers

- **Status:** Won't Fix (technical justification)
- **Severity:** Low
- **Category:** Edge Case (behavior parity)
- **Locations:** `apps/api/src/shared/http/request-id.lifecycle.ts` (hook registration) vs `enableCors` middleware position
- **Technical explanation:** the request-ID hook runs before all middleware including CORS, so the early 400 lacks `Access-Control-Allow-Origin`. This exactly preserves the pre-migration Fastify behavior (an `onRequest` hook also ran before `@fastify/cors`), so it is not a migration regression; browser clients sending malformed IDs are not a supported surface (first-party clients send valid UUIDv4s).
- **Failure scenario:** browser-based client sending a malformed `x-request-id` sees an opaque network error instead of the 400 body; server-to-server clients unaffected.
- **Judge recommendation:** accept as parity, or add CORS headers to the early rejection if browser readability ever matters — do not hand-roll CORS in the hook.
- **Investigation results:** confirmed parity with the Fastify-era behavior; adding CORS headers to a pre-middleware rejection would duplicate the CORS configuration inside the hook for no first-party benefit.
- **Agreed resolution:** Won't Fix — behavior parity preserved deliberately; the hook's existing "before any middleware" comment records the ordering. Revisit only if a browser client surface for that error is ever required.

### CR-06 — Mixed import styles for sibling HTTP modules in the bootstrap

- **Status:** Resolved (2026-11-15)
- **Severity:** Low
- **Category:** Syntax/Code Quality (consistency)
- **Locations:** `apps/api/src/main.ts` (`#http/not-found.fallback.js` next to `./shared/http/request-id.lifecycle.js`); `apps/api/test/create-test-app.ts` (`#src/shared/http/...` where `#http/...` is the established alias)
- **Technical explanation:** two import conventions for the same module boundary in the same files.
- **Failure scenario:** readers and future edits must track two conventions; alias drift.
- **Judge recommendation:** use `#http/...` consistently.
- **Investigation results:** both files updated to the specific aliases; `#src/shared/http/...` removed.
- **Agreed resolution:** applied.

### CR-07 — Duplicate `x-request-id` header lines were accepted (200) after the CR-02 remediation

- **Status:** Resolved (2026-11-15, re-review iteration 2 — CHANGES_REQUIRED verdict)
- **Severity:** Medium (dispatch: Correctness/Edge Case)
- **Category:** Correctness/Edge Case
- **Locations:** `apps/api/src/shared/http/request-id.lifecycle.ts` (hook guard); `apps/api/src/shared/http/request-id.ts` (`readInboundRequestIdHeader`)
- **Technical explanation:** the CR-02 deduplication changed the hook's guard from a raw-header presence check (`header === undefined`) to a normalized-value check (`value === undefined`). The helper returns `undefined` both for an absent header and for an unusable multi-value header, and the adapter's HTTP server (default `joinDuplicateHeaders: false`) surfaces duplicate `x-request-id` lines as an array — so two header lines, which the pre-refactor code rejected with 400 `INVALID_REQUEST_ID`, became accepted requests with a fresh ID, diverging from the comma-joined single-line form (still 400) and contradicting the helper's own comment.
- **Failure scenario:** a proxy re-encoding one comma-joined header into two header lines turns a 400 `INVALID_REQUEST_ID` into a 200; validation answers depend on header-line encoding, and no test pinned the duplicate-line form.
- **Judge recommendation:** restore the raw-presence check while keeping the shared normalization, or discriminate absence from unusability in the helper; either way pin the chosen semantic with an e2e case sending two header lines.
- **Investigation results:** the pre-refactor contract (both duplicate encodings reject) is the correct semantic to preserve — it is behavior this migration must keep, and accepting an ambiguous identity header would weaken the ADR-010 contract. Verified against `@types/node` http server defaults that duplicate lines surface as arrays.
- **Agreed resolution:** applied — the hook checks raw-header presence again (`header === undefined`) alongside the shared normalization (`isValidUuidV4(readInboundRequestIdHeader(req))`), with a comment stating why; a new e2e case pins that duplicate header lines reject with 400 like the comma-joined form. The re-review's CR-04 residual nit (redundant `typeof` before `isValidUuidV4`) was also applied.

## Wave 19 — side-session second-pass diff review (caveman-review, 2026-11-15)

Independent side-session review of the Wave 18 remediated diff. All five
findings were investigated and dispositioned by the main session on
2026-11-15 (statuses below); overlaps with Wave 18 are cross-referenced.

### CR-08 — `requestTimeout` silently moves from disabled to Node's 300 s default

- **Status:** Resolved as documented (2026-11-15 — developer decision: accept the 300 s cap as a safety default; recorded in ADR-032 beside the keep-alive constant)
- **Severity:** Low
- **Category:** Correctness/behavior parity
- **Locations:** `apps/api/src/main.ts` (bootstrap, near `SERVER_KEEP_ALIVE_TIMEOUT_MS`)
- **Technical explanation:** Fastify's default `requestTimeout` is `0` (disabled); the Node HTTP server's default is 300000 ms. The keep-alive timeout was made explicit under ADR-032, but the request timeout was left to the new platform's default — a behavior change the ADR's compatibility table does not list.
- **Failure scenario:** any request whose handling exceeds 5 minutes is killed with 408; today no endpoint does this, so the change is latent rather than breaking.
- **Judge recommendation:** either set `app.getHttpServer().requestTimeout = 0` to preserve Fastify parity, or explicitly document the 300 s cap in ADR-032 beside the keep-alive constant. Developer decision (behavioral).

### CR-09 — `writableEnded` check is narrower than Fastify's `sent`; no `headersSent` guard on the fallback

- **Status:** Resolved (2026-11-15)
- **Severity:** Low
- **Category:** Edge Case
- **Locations:** `apps/api/src/shared/interceptors/response-envelope.interceptor.ts` (`reply.writableEnded`); `apps/api/src/shared/http/http-boundary.ts` (`HttpResponseLike`); `apps/api/src/shared/http/not-found.fallback.ts` (responds without a `res.headersSent` check)
- **Technical explanation:** Fastify's `reply.sent` flips once headers/payload go out; Node's `writableEnded` only after `end()`. A hypothetical handler that writes raw headers and returns data would now be enveloped and then fail the adapter's send (previously skipped). The root fallback likewise responds without checking `res.headersSent`, which would throw if a future raw handler already responded and the router then fell through.
- **Failure scenario:** no current handler touches the raw response — latent. If one lands, the error path yields a 500 where the intent was the handler's own response.
- **Judge recommendation:** add `headersSent` to `HttpResponseLike`, check `writableEnded || headersSent` in the envelope and guard the fallback with `res.headersSent` — or, if the narrower contract is accepted deliberately, fix the envelope's "raw reply usage" comment to match.

### CR-10 — e2e asserts an exact socket address (`::ffff:127.0.0.1`)

- **Status:** Resolved (2026-11-15)
- **Severity:** Low
- **Category:** Edge Case (test robustness)
- **Locations:** `apps/api/test/http-config.e2e-spec.ts` (second test's `.data.ip` assertion)
- **Technical explanation:** the trust-proxy "untrusted fallback" assertion pins the exact IPv4-mapped loopback string Node produces today. CI runners or Node changes can yield `::1`/`127.0.0.1` instead.
- **Failure scenario:** environment-dependent red herring failure of an unrelated migration test.
- **Judge recommendation:** assert the value is a non-empty loopback (`toContain('127.0.0.1')` or a non-X-Forwarded-For value), not the mapped form verbatim.

### CR-11 — CORS parity on the NodeAdapter is untested (distinct from Wave 18 CR-05)

- **Status:** Won't Fix — finding invalid (2026-11-15)
- **Severity:** Low
- **Category:** Test coverage gap
- **Locations:** `apps/api/src/main.ts` (`enableCors` when `CORS_ORIGIN` configured); `apps/api/test/create-test-app.ts` (no option to exercise CORS)
- **Technical explanation:** Wave 18 CR-05 covers the early-400-vs-CORS ordering; this is the broader gap: `NodeAdapter.enableCors` is a fresh code path with no e2e coverage at all (the test env never sets `CORS_ORIGIN`).
- **Failure scenario:** a CORS regression (missing preflight handling, wrong headers) would reach production unobserved by any tier.
- **Judge recommendation:** add an e2e case that enables CORS via a module/adapter option override (pattern exists: `adapterTrustProxy`) and asserts preflight + allowed-origin behavior on the new adapter.

### CR-12 — Minor observations (log parity, redundant header read, mirror comment)

- **Status:** Resolved as documented (2026-11-15)
- **Severity:** Informational
- **Category:** Syntax/Code Quality
- **Locations:** `apps/api/src/shared/http/not-found.fallback.ts` (no warn line — in-prefix 404s get the filter's warn, root 404s only the access log; deliberate per comment); `apps/api/src/shared/http/request-id.lifecycle.ts` (raw header read twice — presence check + helper; could return `{present, value}`); `apps/api/test/create-test-app.ts` (mirror comment could note the intentionally absent `keepAliveTimeout` — tests never `listen()`)
- **Technical explanation:** consistency/polish items with no behavioral impact.
- **Failure scenario:** none; readability and observability-parity questions only.
- **Judge recommendation:** apply or document as deliberate; no urgency.
- **Agreed resolution:** Resolved as documented (2026-11-15) — (1) the fallback's log parity stays deliberate: the pino-http access log records every 404 and the fallback's comment says so; (2) the double raw-header read in the request-ID hook stays deliberate: presence must be checked on the raw header (Wave 18 CR-07) while the normalized value flows through the shared helper — a `{present, value}` discriminated result would re-entangle the two concerns the CR-02/CR-07 fixes separated; (3) the test-factory mirror comment now notes the intentionally absent `keepAliveTimeout` (tests never `listen()`).

---

## Wave 18 security review (2026-11-15) — SECURITY_CHANGES_REQUIRED

Context-blind security judge review of the NodeAdapter migration. 1 Medium,
2 Informational. The judge verified against installed adapter sources: the
request-ID trust/echo invariants, early-response keep-alive draining (no
smuggling), not-found fallback reflection (JSON-serialized, no response
splitting), body-parser limit/poisoning defaults, and structural-contract
surface all sound; no confirmed exploitable vulnerability in the changeset.

### SEC-01 — Binary `TRUST_PROXY` trust-all state feeds client-controlled `req.ip` into the throttler tracker

- **Status:** Resolved (2026-11-15)
- **Severity:** Medium
- **Classification:** CWE-345 enabling CWE-307
- **Locations:** env schema `TRUST_PROXY`; bootstrap adapter construction; throttler tracker consumption (the throttler's default tracker keys per-IP quota on the trust-proxy-resolved `req.ip`)
- **Technical explanation:** `TRUST_PROXY` accepts only `true`/`false`; `true` compiles to trust-every-hop, so `req.ip` resolves to the leftmost, attacker-chosen `X-Forwarded-For` entry behind any proxy that appends to XFF (nginx `proxy_add_x_forwarded_for`, ALBs, CDNs). The default throttler tracker keys per-IP quota on that value, so distinct spoofed values bypass the OTP endpoint limits and grow Redis key cardinality without bound.
- **Failure scenario:** operator sets `TRUST_PROXY=true` behind an appending proxy; attacker rotates `X-Forwarded-For` per request; OTP send/verify limits never trip.
- **Exploitability:** **Not exploitable under the committed configuration** — `TRUST_PROXY=false` in the production and development env files; `true` only in test envs (where trust-proxy behavior itself is the test subject). Carried over from the Fastify configuration with identical trust-all semantics — pre-existing trust-model weakness, not a migration regression.
- **Judge recommendation:** support an explicit proxy allowlist (the adapter's trust compiler already accepts CIDR/string/array forms — only the env schema restricts it); require/ensure the terminating proxy overwrites XFF; consider rejecting non-IP tracker values to bound Redis cardinality; document that `TRUST_PROXY=true` demands an XFF-sanitizing proxy.
- **Investigation results:** real weakness, real pre-existing. The developer approved the allowlist approach (2026-11-15).
- **Agreed resolution:** Resolved (2026-11-15) — new optional `TRUST_PROXY_PROXIES` env variable (comma-separated proxy addresses/CIDR ranges, whitespace-sanitized in the Zod schema, entries sanity-checked, semantic errors fail fast at adapter construction). With `TRUST_PROXY=true` the allowlist narrows trust to the listed proxies; without it the trust-all form remains (documented as requiring an XFF-sanitizing proxy). Synced across `.env.example` and all env files; env-schema unit tests added; `server.config.ts` resolves the adapter-ready value as a single source.

### SEC-02 — Unused supply-chain footprint shipped by `@nestjs/platform-node`

- **Status:** Won't Fix (technical justification)
- **Severity:** Informational
- **Classification:** CWE-1104
- **Locations:** `@nestjs/platform-node` runtime dependencies (`light-my-request`, `multer`, `serve-static`, `send`, `cookie`, `cookie-signature`) — verified unreached on the production request path (lazy loading for the test-injection helper; no multer/static usage in the API source).
- **Failure scenario:** hypothetical install-graph compromise only; none exploitable.
- **Judge recommendation:** none required; periodic `pnpm audit` coverage.
- **Agreed resolution:** Won't Fix — install-graph surface only, net supply-chain reduction versus the removed Fastify stack; covered by routine dependency audits.

### SEC-03 — Pre-routing request-ID rejection path sits outside the throttler and access-log pipeline

- **Status:** Won't Fix (technical justification)
- **Severity:** Informational
- **Classification:** CWE-770 (hardening observation)
- **Locations:** `apps/api/src/shared/http/request-id.lifecycle.ts` (hook rejection path)
- **Technical explanation:** the pre-routing 400 bypasses pino-http access logging and the Redis throttler by design (cheapest-path rejection); per-request cost is one bounded regex plus at most one `randomUUID()`, and each event still emits one `logger.warn` line.
- **Failure scenario:** theoretical log-volume amplifier with no amplification relative to baseline access logging.
- **Judge recommendation:** none required; sample the warn if log volume ever matters.
- **Agreed resolution:** Won't Fix — rejecting before routing is the intended cheapest-path design; adding a Redis round trip to every request would be a worse trade.

## Wave 20 — conditional-request implementation review (2026-11-15)

Context-blind judge review (CHANGES_REQUIRED, iteration 1) of the ETag/304
restoration, Problem Details tagging, and throttler-tracker bounding. 1 High,
1 Medium, 6 Low. The reviewer verified interceptor composition order against
`@nestjs/core` sources, adapter 304 handling, SSE stream header commit
semantics, and throttler tracker normalization. All findings processed:

### CR-01 — ETag hashed the raw payload while claimed to be the wire representation

- **Status:** Resolved (2026-11-15, iteration 2)
- **Severity:** High
- **Category:** Correctness (RFC 9110 strong-validator semantics)
- **Locations:** `apps/api/src/shared/http/etag.ts`, `conditional-request.interceptor.ts`, `app.module.ts` comment, e2e spec
- **Technical explanation:** global interceptor registration order makes the later-registered interceptor innermost, so the conditional interceptor's map ran BEFORE the envelope's: the emitted "strong" tag hashed the raw handler payload while the sent representation (envelope with fresh timestamp/request ID) changed per response — a strong validator that does not change when the representation changes.
- **Agreed resolution:** the validator is now WEAK (`W/"<sha256>"`) over the application payload with honest documentation (validates semantic equivalence; `If-None-Match` compares weakly per RFC 9110 §13.1.2); all comment sites corrected. Revalidation now works (under Fastify the envelope's fresh timestamp meant strong tags never matched in practice — the weak tag is strictly more useful).

### CR-02 — Global interceptor tagged SSE streams and could 304 a live event stream

- **Status:** Resolved (2026-11-15, iteration 2)
- **Severity:** Medium
- **Category:** Correctness/Edge case
- **Locations:** `conditional-request.interceptor.ts` (no SSE skip)
- **Technical explanation:** SSE events flow through interceptor maps before the stream commits headers; the first event would be hashed, an ETag set, and a reconnecting client with a matching candidate would receive a malformed 304-with-body on a `text/event-stream` response.
- **Agreed resolution:** SSE routes skipped via `SSE_METADATA` exactly like the envelope; e2e case asserts the SSE stream carries no ETag.

### CR-03 — Dead content-type pre-set justified by a non-existent adapter behavior

- **Status:** Resolved (2026-11-15, iteration 2)
- **Severity:** Low
- **Category:** Code quality
- **Locations:** `conditional-request.interceptor.ts` (304 branch)
- **Technical explanation:** the adapter's `endWithoutBody` ends 304s before any `writeHead` on every reply path, so the pre-set content type had no effect and its comment described behavior that does not exist.
- **Agreed resolution:** pre-set removed; comment states the actual mechanism.

### CR-04 — Unreachable 304 branch in the Problem Details filter

- **Status:** Resolved (2026-11-15, iteration 2)
- **Severity:** Low
- **Category:** Dead code
- **Locations:** `problem-details.filter.ts`
- **Technical explanation:** Problem Details bodies embed a fresh timestamp and request ID, so `If-None-Match` can never match a previously sent tag; the 304 branch was dead code paid for on every error response.
- **Agreed resolution:** branch removed; the filter sets the ETag header only, with the never-revalidates rationale documented.

### CR-05 — HEAD responses got no ETag although the payload hash matches GET

- **Status:** Resolved (2026-11-15, iteration 2)
- **Severity:** Low
- **Category:** RFC conformance (SHOULD, §9.3.2)
- **Locations:** `conditional-request.interceptor.ts`
- **Technical explanation:** the skip was an artifact of the strong-representation design; with the weak payload validator, HEAD's handler payload hashes identically to GET's.
- **Agreed resolution:** HEAD is tagged with the same validator and revalidates with 304; e2e asserts validator equality with GET and a HEAD 304.

### CR-06 — Third copy of the `isRecord` type guard

- **Status:** Resolved (2026-11-15, iteration 2)
- **Severity:** Low
- **Category:** Duplication
- **Locations:** `http-boundary.ts` (single export now), envelope, filter, conditional interceptor
- **Agreed resolution:** one exported guard consumed by all three.

### CR-07 — Inaccurate scope note; two error paths untagged

- **Status:** Resolved (2026-11-15, iteration 2)
- **Severity:** Low
- **Category:** Comment accuracy/Consistency
- **Locations:** `conditional-request.interceptor.ts`, `request-id.lifecycle.ts`, `not-found.fallback.ts`
- **Technical explanation:** the scope note misdescribed the request-ID rejection (it sends a body; it lacks an ETag because it bypasses the pipeline), and the two bootstrap error paths built the same Problem Details contract as the filter without tagging it.
- **Agreed resolution:** both paths now set the ETag via the shared helper (never revalidates — fresh timestamp — documented at each site). Iteration 2 verified both code fixes but flagged that the interceptor's scope note still claimed the rejection carries no ETag — corrected to the reviewer's wording in the same pass (final status: APPROVED_WITH_SUGGESTIONS).

### CR-08 — Bounded tracker covers only non-IP garbage

- **Status:** Won't Fix (technical justification)
- **Severity:** Low
- **Category:** Edge case (mitigation coverage)
- **Locations:** `redis-throttler.guard.ts`
- **Technical explanation:** the fallback neutralizes syntactically invalid forwarded values; well-formed spoofed IPs under trust-all still mint one key per value.
- **Agreed resolution:** accepted residual, documented explicitly in the guard docstring — the `TRUST_PROXY_PROXIES` allowlist is the real control; extending the fallback to detect trust-all via server config would duplicate configuration the operator already controls.

## Wave 20 re-review (iteration 2, 2026-11-15) — APPROVED_WITH_SUGGESTIONS

All Wave 20 WARNING findings verified FIXED; CR-08 residual accepted. One
comment-only remnant (CR-07's scope note in `conditional-request.interceptor.ts`
still claimed the request-ID rejection carried no ETag) corrected in the same
pass with the reviewer's wording.

---

## Wave 21 — _051 database lifecycle + Enrollment entity (iteration 1, 2026-11-16) — CHANGES_REQUIRED

Code-reviewer report on the `DatabaseLifecycleLogger` provider, the `Enrollment`
entity/module registration, the ORM-options change, and the database-tier test
updates. Migration SQL reviewed separately by `migration-reviewer` (APPROVED,
zero findings).

### CR-01 — Lifecycle logger's bootstrap hook races the boot connect and skips registration on every cold start

- **Status:** Resolved (2026-11-16, verified FIXED in iterations 2–3)
- **Severity:** BLOCKER (iteration 1) → verified valid
- **Category:** Correctness (NestJS lifecycle ordering)
- **Locations:** `src/shared/database/database.lifecycle.ts`, `src/shared/database/database.module.ts`
- **Technical explanation:** both providers sit at the same DI hierarchy level;
  Nest 12 runs same-level `onApplicationBootstrap` hooks concurrently
  (`on-app-bootstrap.hook.js` uses `Promise.all`). The logger's synchronous
  prefix reaches `orm.isConnected()` before the initializer's `connect()` flips
  the connection's `connected` flag, so the guard deterministically logs the
  warn and returns — the pool listeners would never register in production.
  The "registration order defines bootstrap hook order" comments asserted an
  ordering guarantee that does not exist for same-level providers. Confirmed
  against the installed sources (`@nestjs/core` 12.5.0, `@mikro-orm/sql`
  `checkConnection`).
- **Agreed resolution:** constructor-inject `DatabaseConnectionInitializer`
  into `DatabaseLifecycleLogger` — a real DI dependency edge, which lowers the
  logger's hierarchy level ordering so Nest runs its bootstrap hook strictly
  after the initializer's, without changing ADR-034's design (same provider,
  same behavior, same cleanup). The `isConnected()` guard stays (legitimately
  `false` for the `stubDatabaseConnect` test tiers). Comments corrected to
  describe the dependency-edge mechanism; ADR-034's mechanism sentence
  amended to match (decision itself unchanged).

### CR-02 — Two different `#` aliases used for the same BaseEntity module within one feature

- **Status:** Resolved (2026-11-16, verified FIXED in iterations 2–3)
- **Severity:** Low (SUGGESTION)
- **Category:** Consistency (import aliases)
- **Locations:** `src/modules/enrollments/entities/enrollment.entity.ts`, `enrollment.entity.spec.ts`
- **Agreed resolution:** switch both to the dedicated `#database/base.entity.js`
  alias, matching every other consumer.

### CR-03 — Lifecycle spec reaches into a private field via `as unknown as` instead of the repo's logger-spy pattern

- **Status:** Resolved (2026-11-16, verified FIXED in iterations 2–3)
- **Severity:** Low (SUGGESTION)
- **Category:** Test fragility
- **Locations:** `src/shared/database/database.lifecycle.spec.ts`
- **Agreed resolution:** spy on `Logger.prototype` (`log`/`warn`) exactly like
  `redis.service.spec.ts` and `memory-protection.service.spec.ts`; drop the
  private-field cast and the `loggerOf` helper.

### CR-04 — Real-boot listener test cannot detect a regression of the CR-01 fix (iteration 2)

- **Status:** Resolved (2026-11-16, verified FIXED in iteration 3)
- **Severity:** WARNING
- **Category:** Test discriminating power
- **Locations:** `test/enrollment.db-spec.ts` (ADR-034 boot test)
- **Technical explanation:** the driver's `handlePoolErrors` pre-registers
  pool-level `'connect'` and `'error'` listeners on every pool
  (`PostgreSqlConnection.js`), so `listenerCount >= 1` holds even when the
  lifecycle logger never registers; the manual `onApplicationBootstrap()`
  call in the test would also mask a boot-time registration failure.
- **Agreed resolution:** rework the test to identify the logger's own
  listeners: record baseline counts after boot, run
  `beforeApplicationShutdown()` and assert both counts drop by exactly one,
  then `onApplicationBootstrap()` and assert both counts return to baseline
  — proving boot-time registration, cleanup, and re-registration in one
  discriminating pass.

## Wave 21 final (iteration 3, 2026-11-16) — APPROVED

All four findings verified FIXED. CR-01's DI-edge sequencing confirmed
deterministic against the installed Nest core sources; CR-04's reworked
baseline/detach/reattach test fails deterministically on the CR-01 regression
signature (zero listener drop) and proves registration, cleanup identity, and
re-registration in one pass. The ADR-034 amendment in DECISIONS.md was not
judged by the reviewer (out of its scope per dispatch).

## Wave 21 security review (2026-11-16) — SECURITY_APPROVED_WITH_INFORMATIONAL_FINDINGS

Independent code-security-analyzer pass over the same change; no confirmed
vulnerabilities. Two informational findings recorded, neither requires a code
change for approval.

### SEC-01 — PostgreSQL pool error objects logged in full to server-side logs

- **Status:** Won't Fix (accepted residual, informational)
- **Severity:** INFORMATIONAL — CWE-532
- **Locations:** `src/shared/database/database.lifecycle.ts` (pool `'error'` listener)
- **Technical explanation:** pg error objects carry messages, SQLSTATE, stacks,
  and occasionally internal topology — never the connection URL or password.
  Destination is the operator-controlled Pino pipeline (the sanctioned channel
  for raw diagnostics, same pattern as `database.health.ts`).
- **Agreed resolution:** no code change; hardening note recorded — if log
  aggregation ever widens its audience, trim pg errors to `message`/`code`
  before serialization.

### SEC-02 — Plaintext PII column created ahead of any write path

- **Status:** Deferred (informational)
- **Severity:** INFORMATIONAL — CWE-312
- **Locations:** `Migration20261116181139.ts`, `enrollment.entity.ts`
- **Technical explanation:** `phone_number` is provisioned plaintext with no
  retention decision made; today the entity has no read/write path and no
  HTTP surface, so nothing exploitable exists. Uniqueness is explicitly
  rejected by the developer (2026-11-16, business logic): multiple
  `Enrollment` rows with the same `phone_number` are valid.
- **Agreed resolution:** deferred to the first write-path task (tracked in
  `DEFERRED.md`): decide retention, backup posture, and reconcile
  the E.164 documentation shape with the HTTP-facing `09XXXXXXXXX`
  normalization before persisting unvalidated input. No unique constraint on
  `phone_number`, ever.

## Wave 22 — test orchestration & coverage review (_052, code-reviewer, 2026-11-17)

Scope: `_052` files only (turbo.json, root + api package.json, vitest.config.ts,
docs, ADR-035, prompt record). Verdict: **CHANGES_REQUIRED** — the
implementation (scripts, turbo tasks, cache flags, coverage config) was
verified correct against the installed toolchain; all findings are
documentation defects.

- **CR-01 (Medium, Documentation accuracy)** — `docs/current-state.md:235`:
  the orchestration insertion split the e2e-globalSetup sentence, leaving an
  orphaned parenthetical fragment. **Resolved** — sentence flow restored, the
  stale verification note merged in with the corrected count.
- **CR-02 (Medium, Stale statement)** — same file: "database 20/20 verified"
  contradicted the corrected 21-test count. **Resolved** — 21/21, plus an
  explicit pending note for the integration-tier orchestration runs.
- **CR-03 (Medium, Documentation accuracy)** — `apps/api/ONBOARDING.md:346`:
  Docker Compose section still said `pnpm test` runs "unit + e2e". **Resolved**
  — reworded to all four tiers.
- **CR-04 (Medium, Doc trigger miss)** — ONBOARDING section 8 "Useful
  Commands" lacked `test:coverage` (root AGENTS.md trigger table requires
  workspace scripts there). **Resolved** — added.
- **CR-05 (Medium, Doc trigger miss)** — ONBOARDING technology-stack table had
  no row for the new `@vitest/coverage-v8` devDependency. **Resolved** — row
  added with the exact-pin note; Vitest row purpose corrected to the four
  tiers.
- **CR-06 (Low, Verification honesty)** — ADR-035 text read as if integration
  and pre-push verifications were already executed. **Resolved** — both
  sections now carry the pending-at-acceptance qualification referencing
  `prompts/_052-*.md`.
- **CR-07 (Low, Consistency, optional)** — `apps/api/AGENTS.md` quick command
  list lacked `test:coverage`. **Resolved** — added (not blocking).

Re-review dispatched to the same reviewer (iteration 2).

## Wave 22 final (iteration 2, 2026-11-17) — APPROVED

All seven findings verified FIXED against the actual files; no new or
residual findings. The implementation verification from iteration 1 (Vitest
5.0.5 coverage API, turbo cache flags, task-name consistency, tier
isolation, web/admin skip behavior, coverage ignore rules) stands unchanged
— iteration 2 was documentation-only.

## Wave 22 security review (2026-11-17) — SECURITY_APPROVED_WITH_INFORMATIONAL_FINDINGS

Independent code-security-analyzer pass over the same change set; no
confirmed vulnerabilities. Four informational findings, none requires a
code change for approval.

### SEC-01 — Residual npm supply-chain exposure of `@vitest/coverage-v8`

- **Status:** Won't Fix (accepted residual, informational) — CWE-829
- **Technical explanation:** exact-pinned 5.0.5, peer-locked to the exact
  installed Vitest, integrity-hashed in the lockfile, age-policy-passed,
  eight pure-JS transitives from known maintainers, no lifecycle build
  scripts, dev-only and absent from the prod image (`--prod` install). The
  residual is the inherent npm devDependency risk (future compromised
  release + future bump).
- **Agreed resolution:** none now; keep the exact pin and re-run the
  supply-chain policy on any future bump (existing process).

### SEC-02 — Coverage artifacts embed full source; contained today

- **Status:** Won't Fix (hardening note, informational) — CWE-538
- **Technical explanation:** HTML/LCOV under `apps/api/coverage/` contain
  complete source text; git- and docker-ignored, no CI, no static-serving
  path in `apps/api/src`. Flagged: `test:coverage` declares
  `outputs: ["coverage/**"]` — if a remote Turborepo cache is ever enabled,
  source-bearing artifacts would upload to it.
- **Agreed resolution:** none now; when remote caching or CI is introduced,
  revisit the `outputs` declaration (or exclude coverage from cache
  uploads). ADR-035's "stays local, never published" contract must stay
  true as infrastructure evolves.

### SEC-03 — Pre-push now pulls mutable-tag images more often

- **Status:** Won't Fix (pre-existing pattern, informational) — CWE-494
- **Technical explanation:** `redis:8.2-alpine` / `postgres:17.6-alpine`
  tags are mutable upstream; the widened hook increases pull frequency, not
  kind (e2e already pulled at push time). Containers bind dynamic local
  ports only, no host mounts.
- **Agreed resolution:** optional future hardening, out of _052 scope:
  digest-pin the Testcontainers images (and Compose files alike).

### SEC-04 — `DOCKER_HOST`/`DOCKER_CONTEXT` passthrough: no exposure change

- **Status:** Won't Fix (analyzed, informational) — CWE-15, no boundary
  crossed
- **Technical explanation:** pass-through only (never cache-hashed);
  functionally required for Testcontexts to honor a developer's Docker
  context; cache poisoning impossible (Docker tiers are `cache: false`);
  exploitation presupposes full shell-environment control.
- **Agreed resolution:** none; keep the passthrough list minimal.

---

## Wave 23 — database health probe hardening (_053, code-reviewer, 2026-11-17) — CHANGES_REQUIRED

Context-blind code review of the ADR-036 implementation (probe engine, indicator
delegation, pool configuration, health controller, tests, env schema). The
reviewer verified the same-tick ordering guarantees, Terminus contract, i18n
catalogs, and the no-leakage security posture as sound; the findings below are
the exceptions. Findings documented here before remediation per the mandatory
improvement loop.

### CR-01 — Health probe leaks a pool slot when the deadline fires during acquisition

- **Title:** Client acquired after the deadline has fired is never released.
- **Severity:** High
- **Category:** Correctness / Edge Case
- **Location:** `apps/api/src/shared/database/database.probe.ts`, `runProbeQuery`
  (timer callback + `work()`).
- **Status:** Resolved (2026-11-17)
- **Technical explanation:** The deadline callback runs `releaseOnce(timeoutError)`
  while `client` is still `null`; `releaseOnce` sets `released = true`
  unconditionally. `work()` is not cancellable: when the queued
  `pool.connect()` later resolves (bounded by the pool's 5 s
  `connectionTimeoutMillis`), `client = borrowed` executes and the probe
  statement is issued with no release path left (`released` is already true).
  The exactly-once invariant holds for the client that existed at deadline
  time; the late-arriving client gets zero releases.
- **Failure scenario:** Pool saturated by long application loans (runtime
  `statement_timeout` is 30 s). A health probe queues; the 3 s deadline fires
  and the probe correctly fails; within the next 2 s a slot frees, the queued
  acquisition resolves, and the probe silently borrows a client it never
  returns — under a black-holed query it additionally sits idle-in-transaction
  server-side. Continuous health probing under sustained saturation then
  drains one pool slot per slow probe — the protection mechanism itself
  exhausts the pool.
- **Judge recommendation:** In `work()`, immediately after `client = borrowed`,
  check `released`; if the deadline already fired, release the fresh client
  right away (clean release — no query has run) and return without executing
  the probe statement. Add a regression test where `pool.connect()` resolves
  after the deadline.
- **Investigation result:** Valid. The microtask/macrotask ordering only
  protects the client that resolved before the timer ran; the
  resolve-after-timeout case is real and untested.
- **Agreed resolution:** Apply the recommended post-acquisition `released`
  check with a clean release, plus the regression test. No design change —
  this completes the exactly-once release invariant the ADR already specifies.

### CR-02 — Empty `DATABASE_POOL_MAX=` fails startup instead of applying the default

- **Title:** Blank env value violates the documented blank-means-unset convention.
- **Severity:** Medium
- **Category:** Correctness / Edge Case
- **Location:** `apps/api/src/shared/config/env/schema/db.env.ts` (schema) and
  `apps/api/env/.env.example` (the "Leave empty to use the default" comment).
- **Status:** Resolved (2026-11-17)
- **Technical explanation:** `validateEnv` passes raw strings, so
  `DATABASE_POOL_MAX=` reaches the schema as `''`; `z.coerce.number('')` → `0`
  fails `.positive()`. The `.default(10)` applies only to `undefined`. The
  repo convention (stated in `validation-helpers.ts` for `optionalHttpUrlEnv`)
  treats blank values as unset.
- **Failure scenario:** An operator copies `.env.example`, leaves the variable
  empty as documented, and the API refuses to boot with
  `DATABASE_POOL_MAX must be positive.` instead of using the default.
- **Judge recommendation:** Normalize blank to unset before the numeric schema
  (trim → empty-to-undefined transform, then pipe to
  `positiveSafeInteger(...).default(10)`), mirroring `optionalHttpUrlEnv`.
- **Investigation result:** Valid; the shipped `.env.example` explicitly
  documents the empty form.
- **Agreed resolution:** Apply the recommended transform; add schema-spec
  cases for the empty and whitespace-only forms.

### CR-03 — Partial-startup teardown in the db-spec is unguarded

- **Title:** A failed `beforeAll` masks the real error with a teardown TypeError.
- **Severity:** Low
- **Category:** Edge Case (test infrastructure)
- **Location:** `apps/api/test/database-health.db-spec.ts` (file-level
  `afterAll`; per-describe `orm.close(true)` hooks).
- **Status:** Resolved (2026-11-17)
- **Technical explanation:** If a container start throws, `postgres` /
  `toxiproxy` / `network` stay `undefined` and the first teardown statement
  throws a TypeError, skipping the remaining teardown steps and masking the
  root cause.
- **Failure scenario:** One slow/failed image pull produces a teardown crash
  report instead of the actual cause; resources are left for the reaper
  instead of deterministic teardown.
- **Judge recommendation:** Guard each teardown step.
- **Investigation result:** Valid (observed in practice during this task's
  first container-start debugging rounds).
- **Agreed resolution:** Guard the file-level teardown steps; the per-describe
  ORM hooks already fail fast on their own init errors.

## Wave 23 final (iteration 2, 2026-11-17) — APPROVED_WITH_SUGGESTIONS

All three findings verified FIXED by direct inspection (CR-01 re-verified across
the full exactly-once release case matrix; CR-02 semantics for absent/blank/
whitespace/malformed confirmed; CR-03 primary scenario resolved). Two residuals:

### CR-04 — describe-level orm.close hooks in the db-spec still unguarded

- **Status:** Resolved (2026-11-17, same iteration)
- **Severity:** Low | **Category:** Edge Case (test infrastructure)
- **Location:** `apps/api/test/database-health.db-spec.ts` (both describe-level
  `afterAll` hooks).
- **Technical explanation:** if that describe's `MikroORM.init` fails, `orm` is
  undefined and the hook throws a masking TypeError. Downgraded residual of
  CR-03: the guarded file-level teardown already prevents leaks; only noise
  remains.
- **Agreed resolution:** applied the recommended `if (orm)` guard to both hooks,
  matching the file-level pattern.

### CR-05 — positiveSafeInteger blank-value trap in sibling schemas (pre-existing)

- **Status:** Won't Fix in _053 (pre-existing, out of scope) — deferred as a
  follow-up task
- **Severity:** Low | **Category:** Correctness / Edge Case
- **Location:** `apps/api/src/shared/config/env/schema/server.env.ts` (`BODY_LIMIT`),
  `apps/api/src/shared/config/env/schema/redis.env.ts` (`REDIS_CONNECT_TIMEOUT_MS`,
  `REDIS_COMMAND_TIMEOUT_MS`, `REDIS_MAX_RETRIES_PER_REQUEST`,
  `REDIS_SHUTDOWN_TIMEOUT_MS`) with shipped-empty `.env.example` entries that
  document defaults.
- **Technical explanation:** the same defect class CR-02 fixed for
  `DATABASE_POOL_MAX` exists for the five siblings using the bare
  `positiveSafeInteger(...).default(...)` form: a blank shipped-empty entry
  coerces to `0` and fails `.positive()` instead of applying the documented
  default. Touches no file in this change's diff.
- **Agreed resolution:** out of scope for _053 (scope discipline — no unrelated
  refactoring); tracked here as a follow-up: apply the same blank-to-unset
  preprocess (or a shared wrapper) to the five variables with matching spec
  cases, with developer approval as a separate task.

## Wave 23 security review (2026-11-17) — SECURITY_APPROVED_WITH_INFORMATIONAL_FINDINGS

Independent code-security-analyzer pass (no access to the code-reviewer's
report). No CRITICAL/HIGH/MEDIUM/LOW findings; four informational notes. The
single-flight/cache race surface, the composed probe statement, the env input
chain, and the degraded-200/503 information flow were verified against the
installed library sources.

### SEC-INFO-01 — Redis health probe lacks the DB probe's coalescing (asymmetry)

- **Status:** Won't Fix in _053 (pre-existing surface; deferred follow-up candidate)
- **CWE:** CWE-400 | **Location:** `apps/api/src/shared/redis/redis.health.ts`
- **Explanation:** `/health` floods amplify into Redis PINGs at request rate
  (near-1x load addition, each bounded by `commandTimeout`); the DB side is
  now capped by the probe cache. Pre-existing; changing Redis probe semantics
  is a separate decision.
- **Agreed resolution:** none in _053; revisit with the developer if Redis
  health hardening is wanted (same single-flight/TTL pattern applies).

### SEC-INFO-02 — Coarse failure-class fingerprinting via response latency

- **Status:** Won't Fix (accepted inherent property)
- **CWE:** CWE-208/CWE-204 | **Location:** probe deadline mapping
- **Explanation:** failure classes are indistinguishable in the body but
  distinguishable by latency (~RTT vs ~2s vs ~3s); the 3s failure cache caps
  measurement. Masking would require artificial latency padding that degrades
  legitimate monitoring.
- **Agreed resolution:** accepted; recorded as a documented residual.

### SEC-INFO-03 — Subsystem-level health status is exposed by design

- **Status:** Won't Fix (operational control, not an application change)
- **CWE:** CWE-200 | **Location:** health controller payload
- **Explanation:** orchestrator-facing Terminus behavior; network placement
  (restricting `/health` to the orchestration network) is the intended control.
- **Agreed resolution:** deployment responsibility; nothing to change in code.

### SEC-INFO-04 — DATABASE_POOL_MAX has no upper sanity bound

- **Status:** Won't Fix in _053 (operator-trusted config; deferred)
- **CWE:** CWE-20 | **Location:** `db.env.ts` schema
- **Explanation:** an absurd well-formed value would exhaust PostgreSQL
  `max_connections` — a self-inflicted misconfiguration requiring env write
  access (outside the attacker threat model). A `max()` cap would reject
  legitimate large deployments and is a schema-behavior decision.
- **Agreed resolution:** deferred; sizing guidance is documented in the env
  files and ADR-036.

---

## Wave 24 — Redis reliability & black-hole resilience (_054, code-reviewer, 2026-11-17) — APPROVED_WITH_SUGGESTIONS

Context-blind code review of the ADR-037 implementation (RedisHealthProbe, indicator
delegation, socketTimeout/readyCheck/keepAlive options, env chain, black-hole
fault-injection spec). The reviewer re-verified every load-bearing ioredis claim
against the installed sources (commandTimeout rejection-only path, socketTimeout
arm/destroy semantics, close-handler prevCommandQueue parking, offline-queue
fast-fail message, silentEmit fallback) and found the probe state machine and the
integration test's timing chain sound. Two low findings, both applied:

### CR-01 — "Repo-wide blank convention" claim not true for the schema's siblings

- **Status:** Resolved (2026-11-17, iteration 1)
- **Severity:** Low | **Category:** Edge Case (config ergonomics)
- **Location:** `apps/api/src/shared/config/env/schema/redis.env.ts` + `.env.example`.
- **Explanation:** the new comment claimed blank-values-are-unset as a repo-wide
  convention, but only `REDIS_SOCKET_TIMEOUT_MS` implemented it; the four sibling
  numeric fields used bare `positiveSafeInteger(...).default(...)` and would fail
  startup on a blank shipped-empty `.env.example` entry (the pre-existing CR-05
  defect class).
- **Agreed resolution:** extracted `positiveIntegerEnv(field, defaultValue)` into
  `validation-helpers.ts` (blank→undefined preprocess + `positiveSafeInteger` +
  `.default`) and applied it to all five Redis numeric fields; generalized the
  blank-value spec to cover every field. Closes the Redis portion of the deferred
  CR-05 (`BODY_LIMIT` in `server.env.ts` remains deferred — separate schema,
  untouched file).

### CR-02 — No cross-field validation of the socket/command timeout ordering

- **Status:** Resolved (2026-11-17, iteration 1)
- **Severity:** Low | **Category:** Edge Case (missing validation)
- **Location:** `apps/api/src/shared/config/env/schema/redis.env.ts` /
  `env.config.ts` superRefine.
- **Explanation:** three places instruct operators to keep
  `REDIS_SOCKET_TIMEOUT_MS` above `REDIS_COMMAND_TIMEOUT_MS`, but nothing
  validated the ordering; an inverted pair would destroy healthy connections
  mid-flight against a merely slow Redis (constant reconnect churn) with no
  startup signal.
- **Agreed resolution:** added `isRedisSocketTimeoutInvalid` next to the schema
  (following the `isRecoveryThresholdInvalid` pattern) and wired it into the
  existing `envSchema.superRefine` block; spec cases added (valid / equal /
  inverted).

### CR-03 — Informational (pre-existing docs gap, noted by documentation-writer)

- **Status:** Resolved (2026-11-17)
- **Severity:** Low | **Category:** Documentation
- **Location:** `docs/current-state.md` validated-variables list.
- **Explanation:** the list omitted `TRUST_PROXY_PROXIES` (documented in the
  ONBOARDING env table and validated by `server.env.ts`) — pre-existing gap
  noticed during the documentation sweep.
- **Agreed resolution:** added the missing row entry text; other pre-existing
  ADR-range drift in `apps/api/AGENTS.md`/`ONBOARDING.md`/`PROJECT_CONTEXT.md`
  was corrected by the documentation-writer in the same sweep.

## Wave 24 final (iteration 2, 2026-11-17) — APPROVED_WITH_SUGGESTIONS

CR-01 and CR-02 verified FIXED by direct source inspection (helper semantics
re-derived for absent/blank/garbage inputs; cross-field rule confirmed across
`.env.development`, `.env.production`, and the `.env.example` template). One
new low residual:

### CR-04 — Unused `positiveSafeInteger` import in redis.env.ts

- **Status:** Resolved (2026-11-17, iteration 2)
- **Severity:** Low | **Category:** Syntax/Code Quality
- **Location:** `apps/api/src/shared/config/env/schema/redis.env.ts:3`.
- **Explanation:** after absorbing all five numeric fields into
  `positiveIntegerEnv`, the raw-helper import became dead noise.
- **Agreed resolution:** import narrowed to `positiveIntegerEnv` only.

## Wave 24 security review (2026-11-17) — SECURITY_APPROVED_WITH_INFORMATIONAL_FINDINGS

Independent code-security-analyzer pass (no access to the code-reviewer's
report). No CRITICAL/HIGH/MEDIUM/LOW findings; four informational notes. The
single-flight/cache race surface, the composed PING-only probe path, the env
parsing chain (including the new cross-field rule), and the degraded-200/503
information flow were verified against the installed library sources.

### SEC-01 — Cached probe outcome objects were mutable by convention only

- **Status:** Resolved (2026-11-17, same gate)
- **CWE:** CWE-471 | **Location:** `apps/api/src/shared/redis/redis.probe.ts`
  (and the identical pattern in `apps/api/src/shared/database/database.probe.ts`).
- **Explanation:** the single-flight cache hands the same outcome object to
  every concurrent caller on both health endpoints; immutability was a
  doc-comment convention, not a property of the data — one future mutating
  consumer would poison the shared cache across both endpoints for the TTL
  window. No attacker-reachable path today (consumers read `.ok` only).
- **Agreed resolution:** applied the recommended `Object.freeze` at creation in
  BOTH probes — the flagged Redis probe and its PostgreSQL counterpart, which
  carries the identical latent class from ADR-036. Identity-based cache
  assertions in the specs are unaffected.

### SEC-02 — Latency/status fingerprinting of internal failure classes

- **Status:** Won't Fix (accepted documented residual)
- **CWE:** CWE-204 | **Location:** probe deadline mapping, health controller.
- **Explanation:** failure classes remain coarsely distinguishable by latency
  (fast-fail vs 3 s deadline) and per-indicator status on the unauthenticated
  endpoints; error text is properly suppressed (SEC-01/Wave-14 parity verified
  in both i18n catalogs). Inherent to timeout-based health checks; masking
  would require artificial latency padding that degrades legitimate monitoring.
- **Agreed resolution:** accepted; documented in ADR-036/ADR-037 security
  assessments.

### SEC-03 — Probe cache shared between liveness and readiness (bounded staleness)

- **Status:** Won't Fix (accepted ADR-037 design tradeoff)
- **CWE:** N/A | **Location:** `redis.probe.ts` cache TTLs.
- **Explanation:** after a failure, readiness can admit traffic for up to ~5 s
  (success TTL); after recovery, 503 persists up to ~3 s. Not attacker-
  poisonable (no request input reaches the outcome); windows are fixed
  constants matching the orchestrator cadence.
- **Agreed resolution:** accepted; splitting the probes would double Redis
  commands under flood for marginal fidelity.

### SEC-04 — No upper bound on the Redis timeout environment variables

- **Status:** Won't Fix in _054 (operator-trusted config) — recorded in `DEFERRED.md`
- **CWE:** CWE-20 | **Location:** `validation-helpers.ts`, `redis.env.ts`.
- **Explanation:** an absurd well-formed `REDIS_SOCKET_TIMEOUT_MS` passes
  validation and the cross-field rule while effectively disabling the
  black-hole recovery bound (per-command failures still bounded by
  `commandTimeout`). Requires env write access — outside the attacker threat
  model.
- **Agreed resolution:** deferred alongside the `DATABASE_POOL_MAX` cap
  (`DEFERRED.md` item 3, extended to cover the Redis timeout variables); a
  generous named upper bound would be the fix if approved.

## Wave 25 — Phase 0 ETag hardening (_055, code-reviewer, 2026-11-17) — CHANGES_REQUIRED

Context-blind code review of the ADR-038 Phase 0 unit (locale-composed validators,
2xx gate, primitive tagging, shared JSON content-type helpers, envelope, Problem
Details paths, and the new specs). The reviewer re-verified the load-bearing
runtime claims against the installed sources (interceptor composition order,
`NodeResponse.header`/`getHeader` casing, the adapter's binary-view reply path,
`HttpStatus` enum membership, i18n locale resolution) and ruled out eight candidate
issues before reporting. Two Medium and four Low findings:

### CR-01 — Envelope's non-JSON-content-type bypass is evaluated before the handler runs

- **Status:** Resolved (2026-11-17, iteration 1)
- **Severity:** Medium | **Category:** Edge Case
- **Location:** `apps/api/src/shared/interceptors/response-envelope.interceptor.ts`
  (`shouldSkip` eager check vs. lazy map guards).
- **Explanation:** the "reply already set a non-JSON content type (raw reply
  usage)" bypass ran only pre-handler, when nothing had set a content type yet —
  a handler setting one mid-execution got its data enveloped and serialized as
  JSON under the mislabeled content type, while the conditional interceptor's
  lazy check skipped tagging (the two interceptors visibly disagreed).
- **Agreed resolution:** the envelope `map` now re-checks
  `isNonJsonRepresentation(handler, reply)` alongside the `writableEnded`/
  `headersSent` guards and passes the payload through untouched; the eager check
  stays as a cheap early-out. Unit case added.

### CR-02 — ProblemDetailsFilter responds without a committed-response guard

- **Status:** Resolved (2026-11-17, iteration 1)
- **Severity:** Medium | **Category:** Edge Case
- **Location:** `apps/api/src/shared/filters/problem-details.filter.ts` (`catch`).
- **Explanation:** an exception arriving after the response was committed (an
  `@Sse()` stream erroring after headers, or a raw reply that sent and then
  threw) hit the unconditional `reply.status(...).send(problem)` chain —
  `ERR_HTTP_HEADERS_SENT` thrown out of the filter, connection destroyed, and
  because logging sat after the send, the original error was never logged.
- **Agreed resolution:** the responding chain is guarded — a committed response
  never receives a second send; the diagnostic logging tail runs unconditionally
  so the failure is never silently lost. Unit cases added (committed reply → no
  send, logs still written; uncommitted reply → send as before).

### CR-03 — Class doc described a `@ConditionalGet()` decorator and HEAD exclusion that do not exist

- **Status:** Resolved (2026-11-17, iteration 1)
- **Severity:** Low | **Category:** Syntax/Code Quality
- **Location:** `apps/api/src/shared/http/conditional-request.interceptor.ts` (class JSDoc).
- **Explanation:** the doc's forward-looking sentence described Phase 2 behavior
  (opt-in decorator, HEAD exclusion) as if present; documentation must match the
  implementation that exists.
- **Agreed resolution:** stale sentence removed; the implemented gating is fully
  described by the remaining paragraphs. Phase 2 will document its own behavior
  when it exists.

### CR-04 — Validation-message array with no string members normalized to an empty `detail`

- **Status:** Resolved (2026-11-17, iteration 1)
- **Severity:** Low | **Category:** Edge Case
- **Location:** `apps/api/src/shared/filters/problem-details.filter.ts`
  (`detailFromHttpException` array branch).
- **Explanation:** `new BadRequestException([42, {}])` produced
  `"detail": ""` instead of falling back to the exception message every other
  non-representable shape gets.
- **Agreed resolution:** the array branch falls through to the `exception.message`
  fallback when no string members survive the filter. Unit case added.

### CR-05 — Binary-view payloads were enveloped and tagged, silently destroying the representation

- **Status:** Resolved (2026-11-17, iteration 1)
- **Severity:** Low | **Category:** Edge Case
- **Location:** both global interceptors' skip conditions (only `StreamableFile`
  was excluded although the adapter sends ArrayBuffer views as binary).
- **Explanation:** a handler returning a raw `Buffer` would get an envelope-wrapped
  `{"type":"Buffer","data":[…]}` JSON body (plus a validating ETag over the mangled
  bytes) instead of the adapter's `application/octet-stream` binary path.
- **Agreed resolution:** both interceptors skip `ArrayBuffer.isView(data)` payloads
  alongside `StreamableFile` — the adapter's binary path receives them untouched.
  Unit cases added in both specs.

### CR-06 — Built-in exceptions with statuses outside the mapped set publish the application-error Problem Type family

- **Status:** Awaiting Approval (2026-11-17)
- **Severity:** Low | **Category:** Correctness
- **Location:** `apps/api/src/shared/filters/problem-details.filter.ts:74`
  (`errorCodeForStatus`) / `apps/api/src/shared/errors/error.code.ts` (fallback
  `ErrorCode.ApplicationError`, whose Problem Type maps to
  `/problems/application-error`).
- **Explanation:** an ordinary built-in exception with an unmapped status (e.g.
  `UnauthorizedException`, 401) would carry `type: '/problems/application-error'`,
  `code: APPLICATION_ERROR`, and the "Application Error" title — the documented
  intent is that ordinary HTTP errors use RFC 9457's `about:blank`. No current
  thrower produces an unmapped status (guards throw only mapped codes), so no
  live path is affected today.
- **Agreed resolution:** not remediated in this task — the fix changes the
  client-visible error contract (ADR-010 territory) and requires a developer
  decision between extending the per-status code map and routing unmapped
  statuses to a non-typed code. Recorded as a follow-up (`DEFERRED.md`); awaiting
  direction before any contract change.

### CR-07 — Dead test-code remnants (iteration 2, SUGGESTION)

- **Status:** Resolved (2026-11-17, iteration 2)
- **Severity:** Low | **Category:** Syntax/Code Quality
- **Location:** `apps/api/src/shared/filters/problem-details.filter.spec.ts`
  (commented-out pre-fix assertion/handler lines) and
  `apps/api/src/shared/interceptors/response-envelope.interceptor.spec.ts`
  (unused `handlerMetadata` fixture capability).
- **Agreed resolution:** removed in iteration 2 rather than deferred — the
  affected specs were already touched by this task and the remnants carried
  zero information (live assertions supersede them).

## Wave 25 security review (_055, code-security-analyzer, 2026-11-17) — SECURITY_APPROVED_WITH_INFORMATIONAL_FINDINGS

Security review of the Phase 0 unit. The conditional-request surface verified sound
against every focus area: header injection (tags are `W/"<64-hex>"`; the locale is
hashed, never emitted, allowlist-pinned), timing side channels (no CWE-208 — the
compared value is public and the 304 oracle requires a prior authorized 200), 304
disclosure (2xx + GET/HEAD gated), error leakage (generic details, originals in
Pino only), request-ID trust boundaries, and DoS (one bounded sha256 pass; guards
ahead of the pipeline). Four informational findings:

### SEC-01 — Validators on responses without explicit Cache-Control directives

- **Status:** Deferred (2026-11-17) — `DEFERRED.md` follow-up (cache-control policy)
- **Severity:** Informational | **CWE-525** (adjacent; heuristic-cache behavior)
- **Location:** `conditional-request.interceptor.ts` (global tagging/304 surface).
- **Explanation:** ETag/304 makes private-cache reuse of stored envelope bodies
  possible where none was usable before; cross-session reuse requires
  byte-identical application payloads, leaking only the prior envelope's random
  UUID and timestamp (payload mismatch always yields a full 200 — no data
  mismatch is possible). `Vary: Accept-Language` already covers the locale
  dimension for Vary-honoring caches.
- **Agreed resolution:** deferred — no authentication/user-specific responses
  exist yet, and which directives each response class should carry is a
  cache-control policy decision to take when authenticated, user-specific routes
  appear.

### SEC-02 — Loose JSON content-type substring match

- **Status:** Resolved (2026-11-17)
- **Severity:** Informational | **CWE-436** (Interpretation Conflict)
- **Location:** `apps/api/src/shared/http/json-content-type.ts` (`isJsonContentType`).
- **Explanation:** `includes('json')` would classify hypothetical types like
  `application/x-ndjson` as JSON (wrap + tag them). No current route or attacker
  input can reach it (types are route-declared), but the matcher sits on the
  shared classification path of both interceptors.
- **Agreed resolution:** the matcher now accepts exactly the JSON
  structured-syntax forms — `application/json` or the `+json` suffix media type,
  parameters stripped — with a dedicated unit spec (`json-content-type.spec.ts`)
  covering forms, substring non-matches, and non-strings.

### SEC-03 — Committed-response guard asymmetry (not-found fallback)

- **Status:** Resolved (2026-11-17)
- **Severity:** Informational | **CWE-754** (consistency, not reachable on this adapter)
- **Location:** `apps/api/src/shared/http/not-found.fallback.ts` (guard).
- **Explanation:** the fallback guarded only `headersSent` while the filter (post
  CR-02) guards `headersSent || writableEnded`; the unguarded state is not
  reachable for a Node `ServerResponse` today.
- **Agreed resolution:** the fallback's guard is aligned with the filter's.

### SEC-04 — Dead validators on never-revalidating error responses

- **Status:** Accepted documented residual (2026-11-17)
- **Severity:** Informational | **N/A** (design observation, RFC 9110 §8.8)
- **Location:** Problem Details tagging paths (filter, not-found fallback, request-ID lifecycle).
- **Explanation:** error bodies embed a fresh timestamp/request ID per response, so
  their tags never revalidate — header noise at worst; no disclosure (the tag
  hashes a body the client already received).
- **Agreed resolution:** accepted — this is the documented ADR-032/ADR-038 parity
  decision (Phase 0 audit finding F8); removing the header would be an observable
  contract change with no security or correctness gain.

### SEC-04 status update (2026-11-17, after the Mimosa pre-commit block)

- **Status update:** partially applied. The Mimosa pre-commit security gate
  blocked the Phase 0 commit flagging the request-ID lifecycle's
  `weakEtag(JSON.stringify(problem))` as a high-severity taint flow (the body
  embeds the client-supplied, validated, normalized inbound `x-request-id`,
  which reaches the `ETag` response header through the hash — one hop within
  one function). Substantively the echo is the deliberate ADR-010 contract and
  the tag revealed nothing the body did not already carry, but the flagged line
  was also exactly the dead-validator exposure SEC-04 recommended omitting.
  Resolution: the invalid-request-ID rejection no longer carries an entity tag
  (the only tagging site whose input a client can influence); the filter and
  root not-found fallback keep their never-revalidating tags (server-assigned
  IDs only). No test pinned the removed header; ADR-038 Decision 1,
  `docs/current-state.md`, and the prompt record updated to match.
