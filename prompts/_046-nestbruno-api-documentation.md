# _046 — nestbruno API Documentation

## Original request

"document the api with nestbruno tool i already installed it in my machine and provide you the skill of this tool"

User invoked `$ponytail` and `$caveman` session modes and pointed at the
installed `nestbruno` skill (`.zcode/skills/nestbruno/SKILL.md`).

## Implementation

- Loaded the `nestbruno` skill and followed its documentation workflow:
  inspection → read-only extraction → source verification → Markdown
  documentation. No collection-mutating command (`sync`/`generate`/`init`)
  was run: the repo has no Bruno collection and documentation was the
  request.
- `nestbruno` 0.7.0 confirmed via `--version`/`--help`. No `nestbruno.toml`
  exists; not needed for read-only commands (left out deliberately — `init`
  was not requested).
- `nestbruno routes --format json` (cwd `apps/api`): 6 routes,
  `complete: true`, empty diagnostics.
- `nestbruno explain` on both enrollments routes: paths composed from
  controller prefix + handler path; body fields `phoneNumber` (challenge),
  `phoneNumber` + `otp` (verify). Two warnings: global prefix and default
  version applied via constants in `src/main.ts` are not statically provable
  — resolved from source instead (`api`, `v1`, main.ts:23-25, 70-77).
- Source verification of what static analysis cannot derive: Zod schemas
  (`enrollments.schema.ts` — phone normalization `+98`/`0098`/`98`/missing
  zero, `^09\d{9}$`, OTP `^\d{6}$`), service semantics
  (`enrollments.service.ts` — generic indistinguishable failures, hourly
  quota 5/60 min, lockout), controllers (Swagger descriptions, throttle
  limits, health/problem contracts), `main.ts` (prefix exclusions,
  versioning), envelope status field (`openapi.schemas.ts` — integer HTTP
  status).
- Created `docs/api.md`: base paths, global conventions (envelope, RFC 9457
  Problem Details, request IDs, i18n, rate limits, memory protection, no
  auth), 6-endpoint reference table, per-endpoint sections with request/
  response/error contracts and behavior notes, analysis-notes section
  stating exactly what nestbruno resolved and what came from source.
- Updated `PROJECT_CONTEXT.md` Documentation Index with `docs/api.md`
  (Documentation Update Triggers: repository documentation set changed).

## Decisions

- One flat file `docs/api.md` over a `docs/api/` directory: 6 endpoints fit
  one page; flat-file precedent in `docs/` is dominant. (Project-explorer
  offered both; directory form reserved for growth.)
- Development-only Swagger routes (`/docs`) documented as explicitly
  non-production surface rather than omitted.
- No ADR: documentation-only change, no architecture decision
  (root AGENTS.md ADR-first scope).

## Validation

- Docs-only change: no lint/test runs per root AGENTS.md rule.
- nestbruno route inventory cross-checked against
  `docs/current-state.md:107-165` and the controllers — no contradictions.
- Route paths verified: versioned routes under `/api/v1`; `/health`,
  `/health/ready`, `/problems/application-error` prefix-excluded and
  version-neutral (the three easy-to-document-wrong routes).
- No session-started processes; nothing to clean up.
