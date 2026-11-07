# Monorepo Improvements — Phase 2

## Original Request

The user provided an 8-section task to improve the monorepo:

1. Inspect repo, present plan, get approval before implementing
2. Eliminate duplicate `positiveSafeInteger` in apps/api (extract to shared helper)
3. Add YAGNI/DRY/KISS as permanent rules in root AGENTS.md
4. Add Docker Compose scripts to package.json + update onboarding docs
5. Establish `.env.example` as canonical + sync all env files; add sync rules to root AGENTS.md
6. Create `semantic-versioning` Agent Skill + reference it in root AGENTS.md
7. General quality rules (YAGNI/DRY/KISS, no new deps, preserve behavior)
8. Final deliverables report; no commits without authorization

The user approved the plan with "i approve continue".

## Implementation Summary

### 1. Extracted `positiveSafeInteger` to Shared Helper

**File created:** `apps/api/src/shared/config/env/schema/validation-helpers.ts`

```typescript
import { z } from 'zod';

export function positiveSafeInteger(field: string) {
  return z.coerce
    .number({ error: `${field} must be a valid number.` })
    .int(`${field} must be an integer.`)
    .positive(`${field} must be positive.`)
    .refine((value) => Number.isSafeInteger(value), {
      message: `${field} must be within the safe integer range.`,
    });
}
```

**Files updated to use the shared helper:**

- `apps/api/src/shared/config/env/schema/rate-limit.env.ts` — removed local duplicate function
- `apps/api/src/shared/config/env/schema/server.env.ts` — replaced inline Zod refine chain for `BODY_LIMIT` with `positiveSafeInteger('BODY_LIMIT').default(1048576)`
- `apps/api/src/shared/config/env/schema/redis.env.ts` — applied `positiveSafeInteger` to timeout/retry fields:
  - `REDIS_CONNECT_TIMEOUT_MS` (default 10000)
  - `REDIS_COMMAND_TIMEOUT_MS` (default 5000)
  - `REDIS_MAX_RETRIES_PER_REQUEST` (default 3)
  - `REDIS_SHUTDOWN_TIMEOUT_MS` (default 2000)

### 2. Added YAGNI/DRY/KISS Engineering Principles to Root AGENTS.md

Added a new "Engineering Principles: YAGNI, DRY, KISS" section after "General Rules" with detailed rules for each principle:

- **YAGNI** — Implement only currently required functionality; no speculative features, extension points, or premature abstractions
- **DRY** — Avoid duplicating business logic, validation rules, configuration definitions, reusable utilities; extract genuinely shared behavior; don't apply mechanically
- **KISS** — Prefer straightforward implementations; avoid unnecessary indirection, abstraction, inheritance, design patterns

### 3. Added Docker Compose Scripts to package.json + Updated ONBOARDING.md

**apps/api/package.json** — added scripts:

- `docker:dev` — `docker compose --project-directory .. --env-file ../.env.docker -f ../compose.dev.yml up --build -d`
- `docker:dev:down` — `docker compose --project-directory .. --env-file ../.env.docker -f ../compose.dev.yml down`
- `docker:prod` — `docker compose --project-directory .. --env-file ../.env.docker -f ../compose.prod.yml up --build -d`
- `docker:prod:down` — `docker compose --project-directory .. --env-file ../.env.docker -f ../compose.prod.yml down`

**apps/api/ONBOARDING.md** — added "Docker Compose Commands" subsection under section 8 with all 4 commands and prerequisites note.

### 4. Established `.env.example` as Canonical + Sync Rules

**Root AGENTS.md** — added "Environment File Synchronization" section after Documentation Update Triggers table with 7 synchronization rules:

1. Keep variable names consistent across env files
2. Add new variables from `.env.example` to all applicable env files
3. Update all references when variables are renamed
4. Inspect usages before removing variables from other env files
5. Update documentation consistently when variable purpose changes
6. Never update `.env.example` without checking remaining env files
7. Never assume updating only one env file is sufficient

Added comment/documentation requirements and security rules for environment-specific values.

**apps/api/env/.env.development** — synchronized with `.env.example`: added `REDIS_DB`, `REDIS_TLS`, `REDIS_CONNECT_TIMEOUT_MS`, `REDIS_COMMAND_TIMEOUT_MS`, `REDIS_MAX_RETRIES_PER_REQUEST`, `REDIS_SHUTDOWN_TIMEOUT_MS`, `RATE_LIMIT_SHORT_LIMIT`, `RATE_LIMIT_SHORT_TTL_SECONDS`, `RATE_LIMIT_LONG_LIMIT`, `RATE_LIMIT_LONG_TTL_MINUTES` with comments and safe defaults.

**apps/api/env/.env.production** — synchronized with `.env.example`: added same missing variables with comments and safe defaults; preserved production-specific values (e.g., `LOG_LEVEL=info`, `REDIS_URL=redis://redis:6379`, empty `REDIS_USERNAME`/`REDIS_PASSWORD`).

### 5. Created `semantic-versioning` Agent Skill

**File created:** `/home/ali/.claude/skills/semantic-versioning/SKILL.md`

The skill provides actionable instructions for:

- Inspecting package versions and Git history
- Classifying changes (PATCH/MINOR/MAJOR) with monorepo independent versioning model
- Calculating next version
- Updating package.json version as part of implementation commit
- Git tagging with annotated tags (`vX.Y.Z`) after authorized commit
- Completion reporting format
- Integration with Agent Workflow Definition of Done
- Quick reference commands

**Root AGENTS.md** — added reference at end: "Semantic Versioning" section referencing `.claude/skills/semantic-versioning/SKILL.md`.

### 6. General Quality Rules

The YAGNI/DRY/KISS principles from section 2 serve as the permanent engineering rules. No new dependencies were introduced (all changes used existing Zod 4, Oxlint, Oxfmt, Vitest stack). Existing functionality was preserved.

## Validation Results

| Check                        | Result                                |
| ---------------------------- | ------------------------------------- |
| Docker Compose config (dev)  | ✅ Valid                              |
| Docker Compose config (prod) | ✅ Valid                              |
| Lint (Oxlint)                | ✅ 0 errors, 18 pre-existing warnings |
| Format (Oxfmt)               | ✅ Auto-fixed 2 files, now passes     |
| Typecheck (tsc --noEmit)     | ✅ Pass                               |
| Unit tests (Vitest)          | ✅ 196 tests passed (26 files)        |
| E2E tests (supertest)        | ✅ 62 tests passed (13 files)         |
| Redis integration tests      | ✅ 32 tests passed (2 files)          |

## Files Changed

| File                                                          | Change Type                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------- |
| `/home/ali/.claude/skills/semantic-versioning/SKILL.md`       | Created                                                       |
| `apps/api/src/shared/config/env/schema/validation-helpers.ts` | Created                                                       |
| `apps/api/src/shared/config/env/schema/rate-limit.env.ts`     | Modified (import + usage)                                     |
| `apps/api/src/shared/config/env/schema/server.env.ts`         | Modified (import + BODY_LIMIT)                                |
| `apps/api/src/shared/config/env/schema/redis.env.ts`          | Modified (import + 4 fields)                                  |
| `apps/api/package.json`                                       | Modified (4 docker scripts)                                   |
| `apps/api/ONBOARDING.md`                                      | Modified (Docker Compose commands)                            |
| `apps/api/env/.env.development`                               | Modified (synced with .env.example)                           |
| `apps/api/env/.env.production`                                | Modified (synced with .env.example)                           |
| `/home/ali/Desktop/neo-bank/AGENTS.md`                        | Modified (YAGNI/DRY/KISS + env sync rules + semver reference) |

## Remaining Limitations

- The `ENROLLMENTS_MAX_VERIFY_ATTEMPTS` variable from `.env.example` was **not** added to `.env.development` and `.env.production` because it does not exist in `.env.example` (it's in the enrollments schema but not documented in the canonical `.env.example`). This should be added to `.env.example` in a future task.

- The semantic-versioning skill was created but not yet invoked for this task since the root package.json is private (`0.0.0`) and independent versioning applies to workspaces. The apps/api workspace is also at `0.0.0` (private), so no version bump is needed for this internal refactoring task.

- No Git commit has been made — awaiting explicit user authorization per the workflow.

## Next Steps (Pending User Authorization)

1. Create Git commit with all changes including this feature record
2. Optionally create annotated tag if versioning decision applies
