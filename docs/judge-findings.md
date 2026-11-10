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
