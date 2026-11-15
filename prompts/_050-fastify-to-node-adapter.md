# _050 — Fastify to NodeAdapter HTTP Platform Migration

- **Date:** 2026-11-15
- **Status:** Implemented (uncommitted at record time)
- **Decision record:** ADR-032 (supersedes ADR-002)
- **Deferred:** ETag/304 conditional-request support (`DEFERRED.md`, developer decision)

## Original Request

Master prompt (pasted): perform a complete, carefully validated migration of the `apps/api` HTTP platform from NestJS + Fastify (`@nestjs/platform-fastify`) to the official NestJS Node HTTP platform (`@nestjs/platform-node`, `NodeAdapter`). Inspect the whole monorepo, migrate every Fastify-specific dependency and implementation, preserve behavior, update tests, validate throughout; establish platform agnosticism as a permanent architectural rule in the root `AGENTS.md`; evaluate GitNexus's practical effectiveness against conventional search via the `project-explorer` sub-agent; produce a detailed engineering report. No commits unless explicitly requested.

## Implementation Summary

- **Version prerequisite:** `@nestjs/core|common|testing` 12.2.0 → 12.5.0 (the developer ran the upgrade personally; `NodeAdapter` requires ≥ 12.3). `@nestjs/platform-node@12.5.0` added; `@nestjs/platform-fastify`, `fastify`, and `@fastify/static` removed.
- **ADR-032** proposed, amended (ETag deferred to `DEFERRED.md`; keep-alive 20 s), approved, and written as the first repository change; ADR-002 marked superseded.
- **Root `AGENTS.md`:** new "Platform-Agnostic Architecture" rule (nine mandatory guidelines); bootstrap bullet de-Fastified. `apps/api/AGENTS.md` stack/purpose/rules and `apps/api/ONBOARDING.md` rewritten accordingly.
- **Bootstrap (`src/main.ts`):** `NodeAdapter` with the trust-proxy resolution (see SEC-01), explicit `json`/`urlencoded` body parsers limited by `BODY_LIMIT` (replacing the adapter's 100 KB defaults), explicit 20 s keep-alive, request-ID lifecycle on the adapter's `setOnRequestHook`, root-level not-found fallback registered after `init()` (Nest core only mounts its not-found handler under the prefix; developer directed Problem Details everywhere), explicit `app.init()` before `listen()`.
- **Platform-neutral refactoring:** new app-owned `HttpRequestLike`/`HttpResponseLike` contracts (`src/shared/http/http-boundary.ts`); `ProblemDetailsFilter`, `ResponseEnvelopeInterceptor` (`reply.sent` → `writableEnded || headersSent`), `MemoryProtectionGuard`, and the actor-context module no longer import any platform type; the request-ID lifecycle registers through a structural adapter interface.
- **Tests:** `test/create-test-app.ts` mirrors the production bootstrap on `NodeAdapter` (explicit adapter, so no tier can silently test another platform); `http-config.e2e-spec.ts` rewritten behaviorally (413 oversized body, trust-proxy `req.ip` resolution via probe controller, loopback-family assertion); new e2e case pinning duplicate `x-request-id` header-line rejection; `envelope`/`request-id`/`rate-limit`/`base-entity.db-spec` mechanics migrated.
- **Pre-existing failures fixed in passing:** enrollments e2e Redis stub (`useValue` was literally `undefined` since 0a7072b), base-entity db-spec raw SQL (`$1` → `?` for MikroORM 7) and global-EM use (explicit `fork()`).
- **Security hardening (SEC-01, developer-approved):** new optional `TRUST_PROXY_PROXIES` env variable (proxy address/CIDR allowlist used when `TRUST_PROXY=true`), synced across `.env.example` and all env files, with env-schema unit tests.

## Decisions

See `DECISIONS.md` ADR-032 (and its two in-task amendments), `docs/ai-decisions.md` §13–§14, and `docs/judge-findings.md` Waves 18–19 (6 + 5 review findings + 3 security findings, all Resolved/Won't Fix with justification).

## Validation Results

| Command                                 | Result                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `pnpm typecheck` (apps/api)             | PASS                                                                                             |
| `pnpm lint` (apps/api)                  | PASS — 0 errors, 56 warnings (baseline was 58, all pre-existing)                                 |
| `pnpm format:check` / `pnpm format`     | PASS                                                                                             |
| `pnpm build` (apps/api, SWC)            | PASS — 78 files                                                                                  |
| `pnpm test` (unit)                      | PASS — 42 files / 368 tests                                                                      |
| `pnpm test:e2e`                         | PASS — 15 files / 86 tests (Testcontainers)                                                      |
| `pnpm test:redis`                       | PASS — 4 files / 60 tests (one transient Testcontainers hiccup on a shared run; clean on re-run) |
| `pnpm test:db`                          | PASS — 2 files / 17 tests                                                                        |
| GitNexus `impact` (5 symbols, pre-edit) | all LOW risk, no UNKNOWN callers                                                                 |
| GitNexus `detect-changes --scope all`   | executed post-change (expected flow churn)                                                       |

Baseline before any change (recorded for comparison): typecheck/lint/format/build PASS, unit 362/362, e2e 71/83 (12 pre-existing failures — the enrollments stub bug, fixed in this task), redis 60/60, db 16/17 (pre-existing — same test, fixed in this task).

## Notes

- `@nestjs/platform-express` remains in the lockfile as an auto-installed optional peer of `@nestjs/core`/`@nestjs/testing`; not referenced by code.

## Follow-up: remaining issues fixed (2026-11-15, same session)

The three remaining issues from the first final report were fixed:

1. **ETag/304 restored** (was deferred): `ConditionalRequestInterceptor` + `weakEtag`/`ifNoneMatchSatisfied` helpers (`src/shared/http/etag.ts`). WEAK validators over the application payload (the envelope adds per-response metadata, so byte identity is not claimed; `If-None-Match` compares weakly per RFC 9110 §13.1.2); 304 for matching GET/HEAD — and an upgrade over Fastify: Fastify's strong tags covered the full envelope (fresh timestamp/request ID per response), so revalidation never actually succeeded in practice, while the weak payload tag makes conditional caching work for the first time on this API; ETag on other methods, Problem Details responses, and the two bootstrap error paths; SSE skipped. Judge-driven corrections: the validator is weak because the interceptor is INNERMOST (registered-after = runs-before the envelope's map — the first draft's "strong tag over the sent body" claim was wrong), the SSE skip, and a dead content-type pre-set removed. DEFERRED item marked Done; ADR-032 ETag bullet amended; Wave 20 in the tracker (1 High/1 Medium/6 Low → APPROVED_WITH_SUGGESTIONS after iteration 2).
2. **Trust-allowlist e2e coverage** (`http-config.e2e-spec.ts`): `adapterTrustProxy` widened to `boolean | string[]`; two cases prove the narrowed path (loopback allowlist honors XFF; non-matching allowlist ignores it). **Throttler tracker bounded** (`redis-throttler.guard.ts`): a tracker equal to the resolved `req.ip` but not a valid IP falls back to the socket address (custom trackers untouched); residual documented in the guard docstring.
3. **GitNexus index re-analyzed** (`analyze --index-only`): 2,569 nodes / 4,687 edges / 42 flows, current with the working tree.

Validation after the follow-up: typecheck/lint/format/build PASS (0 lint errors, 56 warnings — below the 58 baseline), unit 43 files / 376 tests, e2e 16 files / 96 tests, redis 4 files / 60, db 2 files / 17 — all green. Code review gate: APPROVED_WITH_SUGGESTIONS (iteration 2); the one comment-only remnant was applied and closed in the tracker.

- GitNexus effectiveness measured (same repo state, five discovery tasks, one call each): GitNexus `query` 1.1–1.5 s and 5.7–8.2 KB output per call vs grep 2–5 ms and 0.1–1.7 KB — conventional search wins decisively for lexical discovery; GitNexus's value this session was structural (impact/caller verdicts, mandatory pre-edit checks, execution-flow lists in `detect-changes`). Full table in the session's final report.
