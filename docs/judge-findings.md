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
