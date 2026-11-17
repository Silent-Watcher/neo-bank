# _052 — Monorepo Test Orchestration, Parallel Execution & Coverage

- **Date:** 2026-11-17
- **Status:** Implemented; integration-tier verification pending (Docker Hub `registry-1.docker.io` unreachable from the host at execution time — see Validation)

## Original Request (condensed)

Master prompt (user paste, 2026-11-17): "Monorepo Test Orchestration, Parallel Execution & Coverage" — inspect and improve the monorepo testing infrastructure to:

1. Discover and centralize all existing test commands across the monorepo.
2. Execute independent test suites concurrently during Git `pre-push`.
3. Make the testing infrastructure scalable for future frontend applications and test suites.
4. Introduce a consistent Vitest coverage strategy.
5. Optimize test execution time without compromising reliability, isolation, or correctness.

Mandatory two-stage workflow: discovery + proposal first, explicit approval before implementation; no commits unless requested; no pushes. Full original text preserved in the session history; every numbered requirement is covered by the implementation record below.

## Discovery Findings (Stage 1)

- `apps/api` has exactly four Vitest 5.0.5 tiers, isolated by disjoint file suffixes (`*.spec.ts`, `*.e2e-spec.ts`, `*.redis-spec.ts`, `*.db-spec.ts`), per-tier env files, and Testcontainers containers with dynamic ports (ADR-016/025/027). No jest/playwright/cypress/coverage anywhere; no CI workflows; web/admin have no tests.
- Pre-existing gap: root `test` = `turbo test test:e2e`, so the Husky `pre-push` hook (`pnpm test`) gated pushes on unit + e2e only; `test:redis`/`test:db` were manual-only.
- Pre-existing latent bug: `turbo.json` left `test` and `test:e2e` implicitly cacheable — a cached integration pass would have skipped real Docker verification.

## Implementation

| File                        | Change                                                                                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DECISIONS.md`              | **ADR-035** accepted (first repo write; user-approved proposal): Turborepo-native orchestration, `cache: false` for Docker-backed tiers, unit-tier coverage, convention-based future apps                                |
| `turbo.json`                | New tasks `test:redis`, `test:db` (`cache: false`), `test:coverage` (`outputs: ["coverage/**"]`); `test:e2e` fixed to `cache: false`; explanatory comment                                                                |
| `package.json` (root)       | `test` widened to `turbo test test:e2e test:redis test:db`; new root pass-throughs `test:redis`, `test:db`, `test:coverage`                                                                                              |
| `apps/api/package.json`     | `test:coverage` script (`vitest run --coverage`); devDependency `@vitest/coverage-v8@5.0.5` (exact pin matching Vitest 5.0.5; lockfile passed supply-chain policy)                                                       |
| `apps/api/vitest.config.ts` | `coverage` block: provider `v8`, `reporter: ['text', 'html', 'lcov']`, `include: ['src/**']`, `exclude: ['src/**/*.spec.ts', 'src/**/migrations/**']`; disabled by default so plain unit runs pay no collection overhead |
| `.husky/pre-push`           | **Unchanged** (`pnpm test`) — the widened root definition gates pushes on all four tiers                                                                                                                                 |
| `README.md`                 | Root commands table (all tiers + coverage), orchestration/convention paragraph, pre-push wording                                                                                                                         |
| `apps/api/ONBOARDING.md`    | Test commands incl. `test:coverage`, coverage semantics (unit tier, `coverage.include` = untested files, no thresholds yet), pre-push note                                                                               |
| `docs/current-state.md`     | Testing facts (tiers, orchestration, coverage, ADR-035 status list entry); fixed stale db-tier count 20 → 21                                                                                                             |
| `docs/ai-decisions.md`      | Entries #19–#21 (see below)                                                                                                                                                                                              |

Decisions inside the task (developer-approved proposal, ADR-035):

1. **Coverage on the unit tier only** — deterministic, Docker-free; attaching coverage to integration tiers multiplies runtime ~4× for marginal signal.
2. **No coverage thresholds in v1** — measured baseline recorded first (75.32% statements / 72.08% branches / 82.27% functions / 75.73% lines); incremental ratchet recommended later.
3. **`test:e2e` explicitly `cache: false`** — fixes the latent wrong cacheability found in discovery.
4. **Pre-push hook byte-identical** — gating widened through the root script, keeping a single source of truth.

## Validation

### Verified (2026-11-17)

- Unit tier: 45 files / 386 tests green; **baseline 4.9 s wall** (repeated: 4.6–4.9 s).
- Coverage run (`pnpm --filter @neo-bank/api test:coverage`): exit 0; text table printed; `apps/api/coverage/` contains `index.html`, `lcov-report/`, `lcov.info` (LCOV `SF:` paths verified, e.g. `src/main.ts`); untested files counted via `coverage.include` (`main.ts`, `i18n.module.ts` appear at 0%); generated migrations and spec files absent from the report.
- Turborepo task graph (`--dry=json`): `@neo-bank/api#test:db` shows `cache: {local: false, remote: false}` (Docker-backed tiers never cached) and the correct underlying commands; workspace script discovery works; script-less packages (web/admin) are filtered at execution (verified against the earlier real run scheduling only api tasks).
- Turbo dry-run phantom entries in `--dry=json` for packages without the script are a dry-run display artifact, not an execution behavior.

### Pending — blocked on environment

`registry-1.docker.io` became unreachable from the host (curl: timeout; `auth.docker.io` and the Cloudflare CDN reachable) at exactly the moment the integration baselines were due. `docker pull` of an already-cached image also fails (pull semantics require a registry manifest HEAD). Per the retry-loop prevention rule, no blind retries: e2e/redis/db baseline timings, the four-tier concurrent orchestration proof (task-start timestamps), and the pre-push failure-scenario proof require Docker Hub reachability (or a local mirror) to run Testcontainers. They are recorded here as the first actions to resume.

## References

- DECISIONS.md ADR-035; bundled Turborepo 2.11.10 docs (`node_modules/turbo/docs/`)
- Vitest 5 coverage API verified against installed types (`CoverageOptions`: `provider`, `reporter`, `include`, `exclude`; `coverage.all` no longer exists — explicit `include` is the mechanism)
