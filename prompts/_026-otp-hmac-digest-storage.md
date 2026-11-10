# 026 — HMAC-SHA-256 Digest Storage for Enrollment OTPs

## Original User Request

Prompt (condensed): Act as a senior backend/security engineer. OTP values are currently stored in Redis as plaintext. Implement a secure mechanism so OTPs are never stored in plaintext: generate a secure one-way keyed digest before storing, store only the digest, verify by digesting the submitted value and comparing with `crypto.timingSafeEqual`. Create an ADR, update all affected security estimates/threat documentation, keep the existing OTP lifecycle intact, and do not add dependencies or abstractions. Testing mandatory; do not claim results not actually observed.

User decisions during the ADR fork:

1. Digest comparison entirely in Node.js with `crypto.timingSafeEqual`; no secret digest comparisons via Lua string equality; Lua only for atomic Redis-side state transitions; `WATCH/MULTI/EXEC` acceptable if required.
2. Bind the phone number into the HMAC input.

User approved ADR-018 and implementation ("its ok i accept the adr write it and start the developing").

## Implementation

- **ADR-018** written to `DECISIONS.md` (Accepted) as the first repository write: HMAC-SHA-256 digest storage, dedicated `ENROLLMENTS_OTP_HMAC_SECRET`, phone-bound HMAC input, Node-side `timingSafeEqual`, atomic Lua resolve, alternatives (plaintext / SHA-256 / salted SHA-256 / encryption / Argon2id / Lua-side compare), trade-offs, operational implications. Corrected during review: the resolve's stale-match window (expiry + re-issue with a different digest in the sub-ms gap) is documented as a non-bypass residual.
- **Config:** `ENROLLMENTS_OTP_HMAC_SECRET` added to `apps/api/src/shared/config/env/schema/enrollments.env.ts` (required, regex 64 hex chars = 32 decoded bytes, no default) and mapped as `otpHmacSecret` in the existing `ENROLLMENTS_CONFIG` factory. Synced to `.env.example` (documented placeholder) and generated random values into gitignored `.env.development`, `.env.test`, `.env.production`, `.env.redis-test`.
- **Digest module:** new `apps/api/src/modules/enrollments/enrollments.otp-digest.ts` — `computeOtpDigest` (`createHmac('sha256', keyBuffer).update('<phone>:<otp>')`) and `otpDigestMatches` (hex/length validation, `timingSafeEqual` over 32-byte buffers, fail-closed on missing/malformed stored values).
- **Service:** `requestChallenge` stores only the digest via the unchanged `ISSUE_OTP_SCRIPT`; `verifyChallenge` reads the stored value with `GET`, compares in Node, then resolves atomically.
- **RedisService:** `VERIFY_OTP_ATTEMPTS_SCRIPT`/`verifyOtpAndCountAttempts` replaced by `RESOLVE_OTP_VERIFICATION_SCRIPT`/`resolveOtpVerification` — performs no digest comparison; lockout check → (matched ∧ OTP key exists) → consume otp/attempts/lockout, else count attempt and set lockout at max. Enforced semantics identical to the previous fully-atomic script (including counting attempts when a matched key already disappeared).
- **Docs:** `docs/security-otp-enrollment.md` (digest parameters table, new "Digest and Verification Flow" section, §2.6 concurrency updates, new §2.8 Redis-compromise Scenarios A/B/C + write-access note, §3 assumptions, §4 remaining risks rewritten), `DEFERRED.md` item 1 → Done (adapted to HMAC), `docs/current-state.md` (feature description + ADR-018 in Accepted list), `apps/api/ONBOARDING.md` (env table row).

## Validation

- `pnpm typecheck` — pass (tsc --noEmit, no errors).
- `pnpm test` (Vitest unit) — 56 files / 456 tests pass. New: `enrollments.otp-digest.spec.ts` (known-answer vector independently generated with the OpenSSL CLI, determinism, phone/OTP/secret sensitivity, malformed-stored-value handling), `enrollments.env.spec.ts` (missing/short/long/non-hex/whitespace secret rejected; 64-hex accepted), rewritten `enrollments.service.spec.ts` (digest-not-plaintext storage, matched true/false/missing/malformed paths, config propagation).
- `pnpm test:redis` (Testcontainers) — 4 files / 57 tests pass, including digest-only storage with TTL, stale-key resolve rejection, concurrent attempt limit (exactly 5 INCRs), lockout expiry/reissue, malformed stored digest counting.
- `pnpm test:e2e` — 13 files / 65 tests pass (HTTP contracts unchanged; verify mocks rewire to get/resolveOtpVerification).
- Independent context-blind judge report processed: 1 Medium (verify-path lockout DoS on missing OTP — pre-existing ADR-017/documented §2.5 trade-off, rejected as out of scope), 3 Low (2 rejected as pre-existing/out of scope with justification; stale-match finding accepted → ADR + security doc updated, code unchanged).

## Notes

- The uncommitted import-reordering diff in `enrollments.controller.ts` predates the task and was left untouched.
- No commit created (awaiting explicit user approval).
