# 029 — Redis Stack Migration and Redis Insight in the Development Stack

## Original User Request

Replace the standalone Redis Server Docker image with `redis/redis-stack:latest` (not `redis/redis-stack-server` — Redis Insight must be bundled) so Redis Insight is available automatically when the local stack starts; expose it on port 8001 for local development only, never in production; log `Redis Insight: http://localhost:8001` in the API startup output (host-accessible address, protocol included, no log in environments where it is not exposed); add a permanent retry-loop-prevention rule to the root `AGENTS.md`; create an ADR for the migration. Two-stage workflow: investigation report, stop for approval, no commits.

User approval: "go with recommendations" — i.e. image swap in the **development stack only** (production keeps the version-pinned standalone `redis:8.2-alpine`) and the **optional `REDIS_INSIGHT_URL` env var** approach (the API logs the URL only where the Compose stack injects it).

## Implementation

- **ADR-020** (Accepted, `DECISIONS.md`, first write per the ADR-first rule): development-only Redis Stack migration with bundled Redis Insight; alternatives (no Insight, separate Insight service, Stack image) and consequences documented, including the `latest`-tag vs pinned-image trade-off accepted for the dev tooling image.
- **`compose.dev.yml`:** `redis` service → `image: redis/redis-stack:latest`; the `command:` override replaced by `REDIS_ARGS: "--save '' --appendonly no --requirepass ${REDIS_PASSWORD}"` (the Stack entrypoint's supported mechanism — same persistence and auth semantics as before); new host mapping `${REDIS_INSIGHT_PORT:-8001}:8001`; healthcheck unchanged (`redis-cli` ships in the image). The `api` service injects `REDIS_INSIGHT_URL: http://localhost:${REDIS_INSIGHT_PORT:-8001}` under `environment:`.
- **`.env.docker.example`:** `REDIS_INSIGHT_PORT=8001` documented (development-only port).
- **API:** optional `REDIS_INSIGHT_URL` in `server.env.ts` (trim → blank treated as unset → `z.url({ protocol: /^https?$/ })` → credentials (`user:pass@`) rejected so no secret can reach the log → field-level `.optional()` so a missing key short-circuits); `redisInsightUrl` added to `serverConfig`; `buildStartupLogMessage` renders the `Redis Insight: <url>` section only when the URL is present.
- **`AGENTS.md`:** new permanent `### Retry-Loop Prevention` subsection under `## Agent Workflow` (between Delegated Validation and Execution Process) with the seven required rules verbatim.
- **Docs:** `apps/api/env/.env.example` + `apps/api/ONBOARDING.md` (new optional var), `docs/docker.md` (ports table row + "Redis Insight" section), `docs/current-state.md` (validated vars, infrastructure note, ADR-020 list).

## Independent Judge (context-blind, two rounds)

Round 1: one Medium (empty string must mean "unset" — an env file listing the key blank would otherwise fail boot), two Low (reject userinfo so no credentials can reach the startup log; test gaps). All applied; the trailing `.optional()` omission on the first fix attempt was caught by the newly added unset test and corrected. Round 2: no actionable issues remain; the untested `redisInsightUrl ?? null` bootstrap mapping was accepted as a justified residual (single typed expression, both branches exercised by the log-message tests, e2e boots the app).

## Validation

- `docker compose --env-file .env.docker.dev -f compose.dev.yml config --quiet` — pass; prod validated with placeholder credentials (as before).
- `redis/redis-stack:latest` already present locally (1.42 GB) — no pull needed.
- Dev stack redis service recreated: container healthy on `redis/redis-stack:latest`, ports 6380→6379 (Redis) and 8001→8001 (Insight) exposed. Verified in-container: `redis-cli -a "$REDIS_PASSWORD" ping` → `PONG`; `config get appendonly` → `no`; `config get save` → empty (ephemeral semantics preserved). Redis Insight serves HTTP 200 on `/` and `/health` at `http://localhost:8001`.
- API boot capture (real `node dist/main.js` with `REDIS_INSIGHT_URL=http://localhost:8001`): the startup message ends with `Redis Insight: http://localhost:8001` exactly as specified; a second boot without the variable logs no Insight line.
- Unit: 29 files / 256 tests pass (includes the new schema and log-message cases). e2e: 13 files / 65 tests pass — against the recreated Redis Stack container (6380), confirming unchanged application connectivity. `pnpm format` + `pnpm lint` (0 errors) + `pnpm typecheck` pass.

## Notes

- The dev redis container (`neo-bank-dev-redis-1`) is left running on 6380/8001 (recreated for validation; it was started by this agent in a previous task and holds only ephemeral data).
- No commit created (awaiting explicit user approval).
